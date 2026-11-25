import mysql, { type Connection } from 'mysql2/promise';

let connection: Connection;

try {
    connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    await connection.ping();
    console.log('Connected to MySQL database');
}
catch (error) {
    console.error('Error connecting to MySQL database:', error);
    process.exit(1);
}

export default connection;
