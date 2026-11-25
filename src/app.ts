import express, { type Express, type Request, type Response } from 'express';
import connection from './dbconn.ts';


const app: Express = express();

app.get('/', (req: Request, res: Response) => {
  res.send(connection ? 'Connected to MySQL database' : 'Not connected to MySQL database');
});

app.listen(3000);