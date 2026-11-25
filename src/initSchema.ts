import { type RowDataPacket } from 'mysql2/promise';
import { runQuery, runFileQuery } from './dbconn.ts';

export async function ensureSchema(): Promise<void> {
    const rows = await runQuery<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()'
    );

    if (rows[0].n > 0) {
        console.log('Schema is already initialized.');
        return;
    }

    await runFileQuery(new URL('../db/init/01-schema.sql', import.meta.url));
    console.log('Schema initialized successfully.');
}
