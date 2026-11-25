import { runQuery } from './dbconn.ts';

type AuditAction = 'create' | 'update' | 'delete' | 'publish' | 'login' | 'denied';
type AuditEntity = 'shift' | 'roster' | 'availability' | 'staff' | 'staff_role';

/** Records who did what. Never put passwords or hashes in `details`. */
export async function logAudit(
    actorId: number | null,
    action: AuditAction,
    entityType: AuditEntity,
    entityId: number | null,
    details?: Record<string, unknown>
): Promise<void> {
    try {
        await runQuery(
            'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
            [actorId, action, entityType, entityId, details ? JSON.stringify(details) : null]
        );
    } catch (error) {
        // A failed audit write shouldn't break the user's request
        console.error('Audit log write failed:', error);
    }
}
