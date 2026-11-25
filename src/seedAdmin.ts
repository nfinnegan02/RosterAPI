import { type RowDataPacket } from 'mysql2/promise';
import { runQuery } from './dbconn.ts';
import { checkPasswordRules, hashPassword } from './passwords.ts';

/**
 * Creates the first manager account from .env if it doesn't exist yet.
 * The account must change its password on first sign-in.
 * If the account already exists it is left alone, so changing ADMIN_PASSWORD
 * later does NOT reset the real password.
 */
export async function ensureAdmin(): Promise<void> {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set in .env, skipping admin seed');
        return;
    }

    const problem = checkPasswordRules(password);
    if (problem) {
        throw new Error(`ADMIN_PASSWORD: ${problem}`);
    }

    const existing = await runQuery<RowDataPacket[]>('SELECT staff_id FROM staff WHERE email = ?', [email]);
    if (existing.length > 0) {
        return;
    }

    await runQuery(
        `INSERT INTO staff (first_name, last_name, email, password_hash, access_level, must_change_password)
         VALUES (?, ?, ?, ?, 'manager', TRUE)`,
        [
            process.env.ADMIN_FIRST_NAME || 'Admin',
            process.env.ADMIN_LAST_NAME || 'User',
            email,
            await hashPassword(password),
        ]
    );
    console.log(`Seeded admin account ${email} (must change password on first sign-in)`);
}
