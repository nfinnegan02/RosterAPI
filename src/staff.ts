import { Router, type Request, type Response } from 'express';
import { type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { runQuery, withTransaction } from './dbconn.ts';
import { requireAuth, requireManager, type AuthUser } from './auth.ts';
import { generateTemporaryPassword, hashPassword } from './passwords.ts';
import { logAudit } from './audit.ts';
import { ROLES, parseRoleSelection, type Role } from './object/Role.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What managers see in the staff list (no password hash). */
type StaffSummary = {
    staff_id: number;
    first_name: string;
    last_name: string;
    email: string;
    access_level: 'manager' | 'staff';
    is_active: boolean;
    must_change_password: boolean;
    roles: Role[];
    primary_role: Role | null;
};

/** Replaces a staff member's roles. Must run inside a transaction. */
async function saveRoles(conn: Connection, staffId: number, roles: Role[], primary: Role | null) {
    await conn.execute('DELETE FROM staff_roles WHERE staff_id = ?', [staffId]);
    for (const role of roles) {
        await conn.execute(
            'INSERT INTO staff_roles (staff_id, role, is_primary) VALUES (?, ?, ?)',
            [staffId, role, role === primary]
        );
    }
}

async function loadStaff(staffId?: number): Promise<StaffSummary[]> {
    const where = staffId === undefined ? '' : 'WHERE s.staff_id = ?';
    const rows = await runQuery<RowDataPacket[]>(
        `SELECT s.staff_id, s.first_name, s.last_name, s.email, s.access_level, s.is_active, s.must_change_password,
                sr.role, sr.is_primary
         FROM staff s
         LEFT JOIN staff_roles sr ON sr.staff_id = s.staff_id
         ${where}
         ORDER BY s.is_active DESC, s.last_name, s.first_name, sr.is_primary DESC, sr.role`,
        staffId === undefined ? [] : [staffId]
    );

    const byId = new Map<number, StaffSummary>();
    for (const row of rows) {
        let staff = byId.get(row.staff_id);
        if (!staff) {
            staff = {
                staff_id: row.staff_id,
                first_name: row.first_name,
                last_name: row.last_name,
                email: row.email,
                access_level: row.access_level,
                is_active: Boolean(row.is_active),
                must_change_password: Boolean(row.must_change_password),
                roles: [],
                primary_role: null,
            };
            byId.set(row.staff_id, staff);
        }
        if (row.role) {
            staff.roles.push(row.role);
            if (row.is_primary) staff.primary_role = row.role;
        }
    }
    return [...byId.values()];
}

/** Reads :id from the URL, or null if it isn't a positive whole number. */
function staffIdParam(req: Request): number | null {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------- /api/roles ----------

export const rolesRouter = Router();

/** GET /api/roles: the fixed list of job roles, for dropdowns and checkboxes. */
rolesRouter.get('/', requireAuth, (req: Request, res: Response) => {
    res.json(Object.entries(ROLES).map(([value, label]) => ({ value, label })));
});

// ---------- /api/staff (managers only) ----------

export const staffRouter = Router();
staffRouter.use(requireAuth, requireManager);

/** GET /api/staff: everyone, active first, with their roles. */
staffRouter.get('/', async (req: Request, res: Response) => {
    try {
        res.json(await loadStaff());
    } catch (error) {
        console.error('List staff failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/staff
 * Creates a staff member (optionally with roles) and a random temporary password,
 * which is returned ONCE so the manager can pass it on.
 */
staffRouter.post('/', async (req: Request, res: Response) => {
    const manager = res.locals.user as AuthUser;
    const { first_name, last_name, email, access_level, roles, primary_role } = req.body ?? {};

    const errors: string[] = [];
    if (typeof first_name !== 'string' || !first_name.trim() || first_name.length > 50) errors.push('First name is required (max 50 characters)');
    if (typeof last_name !== 'string' || !last_name.trim() || last_name.length > 50) errors.push('Last name is required (max 50 characters)');
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim()) || email.length > 255) errors.push('A valid email is required');
    if (access_level !== 'staff' && access_level !== 'manager') errors.push('Access level must be staff or manager');
    const selection = parseRoleSelection(roles, primary_role);
    if ('error' in selection) errors.push(selection.error);
    if (errors.length > 0 || 'error' in selection) {
        return res.status(400).json({ error: errors.join('. ') });
    }

    const temporaryPassword = generateTemporaryPassword();
    const cleanEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(temporaryPassword);

    try {
        const staffId = await withTransaction(async conn => {
            const [result] = await conn.execute<ResultSetHeader>(
                `INSERT INTO staff (first_name, last_name, email, password_hash, access_level, must_change_password)
                 VALUES (?, ?, ?, ?, ?, TRUE)`,
                [first_name.trim(), last_name.trim(), cleanEmail, passwordHash, access_level]
            );
            await saveRoles(conn, result.insertId, selection.roles, selection.primary);
            return result.insertId;
        });

        await logAudit(manager.staff_id, 'create', 'staff', staffId, {
            email: cleanEmail, access_level, roles: selection.roles, primary_role: selection.primary,
        });

        const [staff] = await loadStaff(staffId);
        res.status(201).json({ staff, temporaryPassword });
    } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'A staff member with that email already exists' });
        }
        console.error('Create staff failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/** PUT /api/staff/:id/roles  body: { roles: Role[], primary_role?: Role } (replaces all roles) */
staffRouter.put('/:id/roles', async (req: Request, res: Response) => {
    const manager = res.locals.user as AuthUser;
    const staffId = staffIdParam(req);
    if (staffId === null) return res.status(400).json({ error: 'Invalid staff id' });

    const { roles, primary_role } = req.body ?? {};
    if (roles === undefined) return res.status(400).json({ error: 'Roles are required (send [] to remove all)' });
    const selection = parseRoleSelection(roles, primary_role);
    if ('error' in selection) return res.status(400).json({ error: selection.error });

    try {
        const [before] = await loadStaff(staffId);
        if (!before) return res.status(404).json({ error: 'Staff member not found' });

        await withTransaction(conn => saveRoles(conn, staffId, selection.roles, selection.primary));
        await logAudit(manager.staff_id, 'update', 'staff_role', staffId, {
            before: { roles: before.roles, primary_role: before.primary_role },
            after: { roles: selection.roles, primary_role: selection.primary },
        });

        const [after] = await loadStaff(staffId);
        res.json(after);
    } catch (error) {
        console.error('Update roles failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/** PATCH /api/staff/:id/status  body: { is_active: boolean } */
staffRouter.patch('/:id/status', async (req: Request, res: Response) => {
    const manager = res.locals.user as AuthUser;
    const staffId = staffIdParam(req);
    if (staffId === null) return res.status(400).json({ error: 'Invalid staff id' });

    const { is_active } = req.body ?? {};
    if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });

    if (!is_active && staffId === manager.staff_id) {
        return res.status(400).json({ error: "You can't deactivate your own account" });
    }

    try {
        const [target] = await loadStaff(staffId);
        if (!target) return res.status(404).json({ error: 'Staff member not found' });
        if (target.is_active === is_active) return res.json(target);

        // Never leave the venue with no active manager
        if (!is_active && target.access_level === 'manager') {
            const rows = await runQuery<RowDataPacket[]>(
                "SELECT COUNT(*) AS n FROM staff WHERE access_level = 'manager' AND is_active = TRUE AND staff_id <> ?",
                [staffId]
            );
            if (rows[0].n === 0) {
                return res.status(400).json({ error: "Can't deactivate the last active manager" });
            }
        }

        await runQuery('UPDATE staff SET is_active = ? WHERE staff_id = ?', [is_active, staffId]);
        await logAudit(manager.staff_id, 'update', 'staff', staffId, { is_active: { before: target.is_active, after: is_active } });

        const [updated] = await loadStaff(staffId);
        res.json(updated);
    } catch (error) {
        console.error('Update status failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
