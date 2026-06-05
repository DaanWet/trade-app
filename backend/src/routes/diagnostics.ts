import { Router } from 'express';
import { getRecentEvents, getLogFilePath, type RecentEvent } from '../helpers/logger';
import { getActiveLimited, type ProviderId } from '../services/rateLimitMonitor';
import { lastConvertFailures } from '../services/fxService';
import { getAllSettings } from '../helpers/settings';

const router = Router();

/**
 * Only non-sensitive settings keys are surfaced. `display_currency` is safe; anything
 * unknown is dropped so a future PII-bearing setting can't leak here by default.
 */
const SAFE_SETTING_KEYS = new Set(['display_currency']);

export interface DiagnosticsResponse {
  appVersion: string;
  now: string;
  logFilePath: string;
  counters: {
    convertFailures: number;
    rateLimited: ProviderId[];
  };
  settings: Record<string, string>;
  recentEvents: RecentEvent[];
}

/**
 * Local-only diagnostics (bound to 127.0.0.1, single-user). It relays already-stored,
 * already-formatted events plus whitelisted settings — never request bodies or query
 * strings. It is intentionally NOT scrubbed: scrubbing applies to the cloud path (Sentry),
 * not to this on-machine endpoint where tickers/amounts are exactly what you want to see.
 */
router.get('/', (_req, res) => {
  const all = getAllSettings();
  const settings = Object.fromEntries(
    Object.entries(all).filter(([k]) => SAFE_SETTING_KEYS.has(k)),
  );
  const body: DiagnosticsResponse = {
    appVersion: process.env.APP_VERSION ?? '0.0.0-dev',
    now: new Date().toISOString(),
    logFilePath: getLogFilePath(),
    counters: { convertFailures: lastConvertFailures(), rateLimited: getActiveLimited() },
    settings,
    recentEvents: getRecentEvents(),
  };
  res.json(body);
});

export default router;
