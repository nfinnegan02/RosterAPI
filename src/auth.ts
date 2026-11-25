import { Router, type Request, type Response, type NextFunction } from 'express';
import { type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { runQuery } from './dbconn.ts';
import { type Staff } from './object/Staff.ts';
import { checkPasswordRules, hashPassword } from './passwords.ts';
import { logAudit } from './audit.ts';

/** Shared info about the signed-in user. */
export type AuthUser = Pick<Staff, 'staff_id' | 'first_name' | 'last_name' | 'access_level' | 'must_change_password'>;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    // Refuse to start with a missing/weak secret: anyone could spoof tokens otherwise
    console.error('JWT_SECRET must be set in .env (at least 32 characters)');
    process.exit(1);
}

const COOKIE_NAME = 'token';
const SESSION_MS = 60 * 60 * 1000; // 1 hour

// Used when the email doesn't exist, so the response takes the same time either way
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const USER_COLUMNS = 'staff_id, first_name, last_name, access_level, must_change_password';

/** MySQL returns BOOL as 0/1; turn it into a real boolean for the frontend. */
function toAuthUser(row: AuthUser): AuthUser {
    return {
        staff_id: row.staff_id,
        first_name: row.first_name,
        last_name: row.last_name,
        access_level: row.access_level,
        must_change_password: Boolean(row.must_change_password),
    };
}

/** Loads an active user by id. Identity always comes from the DB, not from the client. */
async function findActiveUser(staffId: number): Promise<AuthUser | null> {
    const rows = await runQuery<(AuthUser & RowDataPacket)[]>(
        `SELECT ${USER_COLUMNS} FROM staff WHERE staff_id = ? AND is_active = TRUE`,
        [staffId]
    );
    return rows[0] ? toAuthUser(rows[0]) : null;
}

// ---------- Middleware ----------

/**
 * Lets the request through only with a valid token cookie.
 * Sets res.locals.user to the user freshly loaded from the database, so
 * demoted or deactivated staff lose access immediately.
 * Does NOT check must_change_password (used by /me and /change-password).
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
        return res.status(401).json({ error: 'Not signed in' });
    }

    let payload: jwt.JwtPayload;
    try {
        // algorithms pinned so a token can't pick its own (e.g. "none")
        payload = jwt.verify(token, JWT_SECRET as string, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
        res.clearCookie(COOKIE_NAME);
        return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    try {
        const user = await findActiveUser(Number(payload.staff_id));
        if (!user) {
            res.clearCookie(COOKIE_NAME);
            return res.status(401).json({ error: 'Not signed in' });
        }
        res.locals.user = user;
        next();
    } catch (error) {
        console.error('Auth lookup failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

/** Use on every data route: signed in AND has set their own password. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    authenticate(req, res, () => {
        const user = res.locals.user as AuthUser;
        if (user.must_change_password) {
            return res.status(403).json({ error: 'You must change your password first', code: 'PASSWORD_CHANGE_REQUIRED' });
        }
        next();
    });
}

/** Use after requireAuth on any route that changes data. */
export function requireManager(req: Request, res: Response, next: NextFunction) {
    const user = res.locals.user as AuthUser | undefined;
    if (user?.access_level !== 'manager') {
        void logAudit(user?.staff_id ?? null, 'denied', 'staff', null, { method: req.method, path: req.originalUrl });
        return res.status(403).json({ error: 'Manager access required' });
    }
    next();
}

// ---------- Routes (mounted at /api/auth) ----------

export const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    let staff: (AuthUser & { password_hash: string } & RowDataPacket) | undefined;
    try {
        const rows = await runQuery<(AuthUser & { password_hash: string } & RowDataPacket)[]>(
            `SELECT ${USER_COLUMNS}, password_hash FROM staff WHERE email = ? AND is_active = TRUE`,
            [email.trim().toLowerCase()]
        );
        staff = rows[0];
    } catch (error) {
        console.error('Login query failed:', error);
        return res.status(500).json({ error: 'Server error' });
    }

    // Always run bcrypt, even for unknown emails, so timing doesn't reveal which emails exist
    const valid = await bcrypt.compare(password, staff?.password_hash ?? DUMMY_HASH);
    if (!staff || !valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Only the id goes in the token; access level is re-read from the DB on every request
    const token = jwt.sign({ staff_id: staff.staff_id }, JWT_SECRET as string, {
        algorithm: 'HS256',
        expiresIn: SESSION_MS / 1000,
    });

    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,                                 // browser JS can't read it
        sameSite: 'strict',                             // not sent on cross-site requests
        secure: process.env.NODE_ENV === 'production',  // HTTPS only when deployed
        maxAge: SESSION_MS,
    });

    return res.json(toAuthUser(staff));
});

authRouter.get('/me', authenticate, (req: Request, res: Response) => {
    res.json(res.locals.user);
});

authRouter.post('/change-password', authenticate, async (req: Request, res: Response) => {
    const user = res.locals.user as AuthUser;
    const { currentPassword, newPassword } = req.body ?? {};

    if (typeof currentPassword !== 'string' || !currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
    }
    const problem = checkPasswordRules(newPassword);
    if (problem) {
        return res.status(400).json({ error: problem });
    }
    if (newPassword === currentPassword) {
        return res.status(400).json({ error: 'New password must be different from the current one' });
    }

    try {
        const rows = await runQuery<({ password_hash: string } & RowDataPacket)[]>(
            'SELECT password_hash FROM staff WHERE staff_id = ?',
            [user.staff_id]
        );
        if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        await runQuery(
            'UPDATE staff SET password_hash = ?, must_change_password = FALSE WHERE staff_id = ?',
            [await hashPassword(newPassword), user.staff_id]
        );
        await logAudit(user.staff_id, 'update', 'staff', user.staff_id, { change: 'password' });

        res.json({ ...user, must_change_password: false });
    } catch (error) {
        console.error('Change password failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

authRouter.post('/logout', (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ message: 'Signed out' });
});
