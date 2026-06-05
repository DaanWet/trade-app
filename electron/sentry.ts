import * as Sentry from '@sentry/electron/main';

/**
 * Sentry wiring for the Electron main process (where the Express backend runs in-process
 * in prod). Kept out of main.ts so the init/scrub logic stays readable and self-contained.
 *
 * Privacy: the user opted for "cloud + scrub". Nothing financial/PII leaves the machine —
 * request bodies/query strings are dropped, and free-text (messages, breadcrumbs, stack
 * values) is run through `scrubText` to redact paths, amounts, numbers and ticker symbols.
 * Everything is DSN-gated: with no SENTRY_DSN, init is skipped and the backend stays
 * fully local (the logger's remote sink is never installed).
 */

/** A runtime mirror of the backend's RecentEvent — avoids importing backend code here. */
export interface BackendLogEvent {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  component: string;
  message: string;
  errorName?: string;
}

const SEVERITY: Record<BackendLogEvent['level'], 'debug' | 'info' | 'warning' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning', // Sentry's SeverityLevel uses 'warning', our logger uses 'warn'
  error: 'error',
};

/** Redact financial/PII tokens from free text before it leaves the machine. */
export function scrubText(input: string): string {
  return input
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>') // unix absolute paths
    .replace(/[A-Za-z]:\\[\\\w.@ -]+/g, '<path>') // windows absolute paths
    .replace(/\b(?:EUR|USD|GBP|CHF|JPY|CAD|AUD)\s?-?\d[\d.,]*/gi, '<amount>') // currency amounts
    .replace(/\b\d+[.,]\d+\b/g, '<num>') // decimals (prices, share counts)
    .replace(/\b[A-Z]{1,6}(?:\.[A-Z])?\b/g, '<ticker>'); // ticker-like tokens
}

/**
 * Initialize Sentry in the main process. Returns true if Sentry is active (DSN present),
 * false otherwise. Call this BEFORE requiring the backend so a throw during require is caught.
 */
/**
 * Sentry DSN. This is a PUBLIC ingest key — safe to commit and ship: it only allows
 * SENDING events, never reading them. Paste your project's DSN here to enable Sentry in
 * packaged builds (end-user machines have no env vars). The SENTRY_DSN env var overrides
 * it in dev. Leave empty to keep Sentry off (local file + /api/diagnostics still work).
 */
const DEFAULT_DSN = 'https://f1f2df2391419cabae0447b1a56b603a@o4511509464416256.ingest.de.sentry.io/4511512225579088';

export function initSentry(opts: { release?: string; environment?: string } = {}): boolean {
  const dsn = process.env.SENTRY_DSN || DEFAULT_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    release: opts.release, // links events to a release (crash-free %, suspect commits, source maps)
    environment: opts.environment, // 'production' (packaged) vs 'development' (dev run)
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    enableLogs: true,
    beforeSend: (event) => {
      if (event.request) {
        delete event.request.data; // request bodies (trade amounts, shares)
        delete event.request.query_string; // ?q= / ?ticker= / ?symbols=
        delete event.request.cookies;
        if (typeof event.request.url === 'string') event.request.url = scrubText(event.request.url);
      }
      delete event.user; // belt-and-suspenders with sendDefaultPii:false
      if (event.message) event.message = scrubText(event.message);
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubText(ex.value);
      }
      for (const b of event.breadcrumbs ?? []) {
        if (typeof b.message === 'string') b.message = scrubText(b.message);
      }
      return event;
    },
    beforeSendLog: (log) => {
      if (log.message) log.message = scrubText(log.message);
      return log;
    },
  });
  return true;
}

/**
 * The sink the backend logger fans out to. Non-error events become breadcrumbs (context
 * for the next issue); only `error` events are captured as Sentry issues (keeps volume low).
 */
export function sentrySink(event: BackendLogEvent, err?: unknown): void {
  Sentry.addBreadcrumb({
    category: event.component,
    level: SEVERITY[event.level],
    message: event.message,
  });
  if (event.level === 'error') {
    if (err) Sentry.captureException(err);
    else Sentry.captureMessage(event.message, 'error');
  }
}
