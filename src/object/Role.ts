/**
 * Job roles, stored as a MySQL ENUM in staff_roles.role, shifts.role and published_shifts.role.
 * To add a role: add it here AND to those three ENUMs in db/init/01-schema.sql
 * (and ALTER TABLE ... MODIFY role ENUM(...) on an existing database).
 */
export const ROLES = {
    chef: 'Chef',
    kitchen_porter: 'Kitchen porter',
    waiter: 'Waiter',
    bartender: 'Bartender',
    host: 'Host',
    receptionist: 'Receptionist',
    housekeeping: 'Housekeeping',
} as const;

export type Role = keyof typeof ROLES;

export function isRole(value: unknown): value is Role {
    return typeof value === 'string' && Object.hasOwn(ROLES, value);
}

/**
 * Validates a role selection from the client.
 * Returns the cleaned roles and primary role, or an error message.
 * Rules: every role must be valid, no duplicates, and if any roles are
 * given exactly one is primary (defaults to the first).
 */
export function parseRoleSelection(
    roles: unknown,
    primaryRole: unknown
): { roles: Role[]; primary: Role | null } | { error: string } {
    if (roles === undefined) return { roles: [], primary: null };
    if (!Array.isArray(roles)) return { error: 'Roles must be a list' };
    if (!roles.every(isRole)) return { error: `Unknown role. Valid roles: ${Object.keys(ROLES).join(', ')}` };
    const unique = [...new Set(roles)] as Role[];

    if (unique.length === 0) return { roles: [], primary: null };
    if (primaryRole === undefined || primaryRole === null || primaryRole === '') {
        return { roles: unique, primary: unique[0] };
    }
    if (!isRole(primaryRole) || !unique.includes(primaryRole)) {
        return { error: 'Primary role must be one of the selected roles' };
    }
    return { roles: unique, primary: primaryRole };
}
