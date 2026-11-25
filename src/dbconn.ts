import mysql, { type Connection, type ConnectionOptions } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';

const dbConfig: ConnectionOptions = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
};

let connection: Connection;
/**
 * Quick test to see if the database is reachable. If not, exit the process.
 */
try {
    connection = await mysql.createConnection(dbConfig);
    await connection.ping();
    console.log('Connected to MySQL database');
}
catch (error) {
    console.error('Error connecting to MySQL database:', error);
    process.exit(1);
}

export default connection;

/**
 * No options: returns the shared app connection.
 * With options: opens a NEW temporary connection using those extra settings
 * (e.g. { multipleStatements: true }). Close it with closeConnection(conn).
 */
export async function getConnection(options?: Partial<ConnectionOptions>): Promise<Connection> {
    if (options) {
        return mysql.createConnection({ ...dbConfig, ...options });
    }
    if (!connection) {
        throw new Error('Database connection is not established');
    }
    return connection;
}

/**
 * No argument: closes the shared app connection (use on shutdown only).
 * With a connection: closes just that one.
 */
export async function closeConnection(conn: Connection = connection): Promise<void> {
    if (conn) {
        await conn.end();
        if (conn === connection) {
            console.log('MySQL database connection closed');
        }
    }
}

export async function runQuery<T extends mysql.RowDataPacket[]>(query: string, params?: any[]): Promise<T> {
    if (!connection) {
        throw new Error('Database connection is not established');
    }
    const [rows] = await connection.execute<T>(query, params);
    return rows;
}

/** Runs a whole .sql file (many statements) on a temporary connection. */
export async function runFileQuery(filePath: string | URL): Promise<void> {
    const sql = await readFile(filePath, 'utf-8');
    const fileConn = await getConnection({ multipleStatements: true });
    try {
        await fileConn.query(sql);   // query(), not execute(): execute only allows one statement
    } finally {
        await closeConnection(fileConn);   // closes only the temporary connection
    }
}
