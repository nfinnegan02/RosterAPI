import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Returns an error message, or null if the password is acceptable. */
export function checkPasswordRules(password: unknown): string | null {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    if (password.length > 72) {
        return 'Password must be 72 characters or fewer'; // bcrypt ignores anything past 72 bytes
    }
    return null;
}

/** A random one-time password, e.g. for newly created staff. */
export function generateTemporaryPassword(): string {
    return randomBytes(9).toString('base64url'); // 12 characters
}
