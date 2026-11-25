import { Router, type Request, type Response, type NextFunction } from 'express';
import { type RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { runQuery } from './dbconn.ts';
import { type Staff } from './object/Staff.ts';

/** What we keep about the signed-in user (never includes the password hash). */
export type AuthUser = Pick<Staff, 'staff_id' | 'first_name' | 'last_name' | 'access_level'>;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    // Refuse to start with a missing/weak secret: anyone could forge tokens otherwise
    console.error('JWT_SECRET must be set in .env (at least 32 characters)');
    process.exit(1);
}

const COOKIE_NAME = 'token';
const SESSION_MS = 60 * 60 * 1000; // 1 hour

// Used when the email doesn't exist, so the response takes the same time either way
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/** Loads an active user by id. Identity always comes from the DB, not from the client. */
async function findActiveUser(staffId: number): Promise<AuthUser | null> {
    const rows = await runQuery<(AuthUser & RowDataPacket)[]>(
        'SELECT staff_id, first_name, last_name, access_level FROM staff WHERE staff_id = ? AND is_active = TRUE',
        [staffId]
    );
    return rows[0] ?? null;
}

// ---------- Middleware ----------

/**
 * Lets the request through only with a valid token cookie.
 * Sets res.locals.user to the user freshly loaded from the database, so
 * demoted or deactivated staff lose access immediately.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
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

/** Use after requireAuth on any route that changes data. */
export function requireManager(req: Request, res: Response, next: NextFunction) {
    const user = res.locals.user as AuthUser | undefined;
    if (user?.access_level !== 'manager') {
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

    let staff: (Staff & RowDataPacket) | undefined;
    try {
        const rows = await runQuery<(Staff & RowDataPacket)[]>(
            'SELECT staff_id, first_name, last_name, access_level, password_hash FROM staff WHERE email = ? AND is_active = TRUE',
            [email]
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

    const user: AuthUser = {
        staff_id: staff.staff_id,
        first_name: staff.first_name,
        last_name: staff.last_name,
        access_level: staff.access_level,
    };
    return res.json(user);
});

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
    res.json(res.locals.user);
});

authRouter.post('/logout', (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ message: 'Signed out' });
});
