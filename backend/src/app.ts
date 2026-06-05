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
import diagnosticsRouter from './routes/diagnostics';
import { getActiveLimited } from './services/rateLimitMonitor';
import { logger } from './helpers/logger';

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
  // Let the cross-origin frontend read the rate-limit signal header.
  exposedHeaders: ['X-Rate-Limited'],
}));
app.use(express.json({ limit: '2mb' }));

// Tag every API response with the providers currently rate-limited (if any). We wrap
// res.json so the header is computed at send-time — capturing a 429 hit *during* this
// request (the only correct spot in Express 5, since headers can't change after flush).
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    const limited = getActiveLimited();
    if (limited.length) res.setHeader('X-Rate-Limited', limited.join(','));
    return originalJson(body);
  }) as typeof res.json;
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Debug/verification endpoint; the frontend uses the X-Rate-Limited header, not this.
app.get('/api/status', (_req, res) => res.json({ rateLimited: getActiveLimited() }));

app.use('/api/trades', tradesRouter);
app.use('/api/positions', positionsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/tax', taxRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/cash', cashRouter);
app.use('/api/diagnostics', diagnosticsRouter);

if (STATIC_DIR) {
  app.use(express.static(STATIC_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // logger.error routes to file + ring buffer + remote sink (Sentry captureException in prod).
  logger.error('error', err.message, err);
  res.status(500).json({ error: err.message });
});

export { CORS_ORIGINS };
// Re-exported so the Electron main process can inject a Sentry-backed sink after Sentry.init
// without the backend ever importing Electron/Sentry (keeps bare-node dev/tests clean).
export { setRemoteSink, logger } from './helpers/logger';
export type { RecentEvent, LogLevel, RemoteSink } from './helpers/logger';
