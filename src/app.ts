import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import connection from './dbconn.ts';
import { ensureSchema } from './initSchema.ts';
import { authRouter } from './auth.ts';

const app: Express = express();

app.use(express.json());    // parses JSON bodies into req.body
app.use(cookieParser());    // parses cookies into req.cookies

app.get('/', (req: Request, res: Response) => {
  res.send(connection ? 'Connected to MySQL database' : 'Not connected to MySQL database');
});

app.use('/api/auth', authRouter);

// Protect other routes like this:
// app.get('/api/shifts', requireAuth, handler);
// app.post('/api/shifts', requireAuth, requireManager, handler);

try {
  await ensureSchema();
} catch (error) {
  console.error('Error ensuring schema:', error);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
