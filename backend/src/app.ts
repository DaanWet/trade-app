import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import './db'; // initialize DB + run migrations on import

import tradesRouter from './routes/trades';
import positionsRouter from './routes/positions';
import pricesRouter from './routes/prices';
import taxRouter from './routes/tax';
import settingsRouter from './routes/settings';
import cashRouter from './routes/cash';

const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:4200,http://localhost:4222,http://localhost:33793')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const STATIC_DIR = process.env.STATIC_DIR;

export const app = express();

const LOOPBACK_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
    // Allow any loopback origin so Electron's random port is accepted
    if (LOOPBACK_RE.test(origin)) return cb(null, true);
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
app.use('/api/cash', cashRouter);

if (STATIC_DIR) {
  app.use(express.static(STATIC_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

export { CORS_ORIGINS };
