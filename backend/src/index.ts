import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import './db'; // initialize DB + run migrations on import

import tradesRouter from './routes/trades';
import positionsRouter from './routes/positions';
import pricesRouter from './routes/prices';
import taxRouter from './routes/tax';
import settingsRouter from './routes/settings';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:4200,http://localhost:4222,http://localhost:33793')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl (no Origin header) and any whitelisted origin.
    if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
}));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/trades', tradesRouter);
app.use('/api/positions', positionsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/tax', taxRouter);
app.use('/api/settings', settingsRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] CORS origins: ${CORS_ORIGINS.join(', ')}`);
});
