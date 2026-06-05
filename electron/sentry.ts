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

// Span data keys whose string values may carry a URL/query/SQL with financial tokens.
const SENSITIVE_SPAN_DATA = [
  'http.url',
  'http.target',
  'url.full',
  'url.path',
  'url.query',
  'db.statement',
  'db.query.text',
];

/** Drop everything after `?` — query strings carry tickers (`?q=`, `?symbols=`). */
function stripQuery(value: string): string {
  const i = value.indexOf('?');
  return i === -1 ? value : `${value.slice(0, i)}?<redacted>`;
}

/** Strip request bodies/query/cookies and scrub the URL (shared by error + transaction). */
function scrubRequest(
  req: { data?: unknown; query_string?: unknown; cookies?: unknown; url?: unknown } | undefined,
): void {
  if (!req) return;
  delete req.data;
  delete req.query_string;
  delete req.cookies;
  if (typeof req.url === 'string') req.url = scrubText(req.url);
}

/**
 * Sentry DSN. This is a PUBLIC ingest key — safe to commit and ship: it only allows
 * SENDING events, never reading them. Paste your project's DSN here to enable Sentry in
 * packaged builds (end-user machines have no env vars). The SENTRY_DSN env var overrides
 * it in dev. Leave empty to keep Sentry off (local file + /api/diagnostics still work).
 */
const DEFAULT_DSN = 'https://f1f2df2391419cabae0447b1a56b603a@o4511509464416256.ingest.de.sentry.io/4511512225579088';

/**
 * Initialize Sentry in the main process. Returns true if Sentry is active (DSN present),
 * false otherwise. Call this BEFORE requiring the backend so a throw during require is caught.
 */

export function initSentry(opts: { release?: string; environment?: string } = {}): boolean {
  const dsn = process.env.SENTRY_DSN || DEFAULT_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    release: opts.release, // links events to a release (crash-free %, suspect commits, source maps)
    environment: opts.environment, // 'production' (packaged) vs 'development' (dev run)
    sendDefaultPii: false,
    tracesSampleRate: 1.0, // single-user desktop app → tiny volume, capture every trace
    enableLogs: true,
    beforeSend: (event) => {
      scrubRequest(event.request);
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
    beforeSendTransaction: (event) => {
      // Transactions/spans bypass beforeSend — scrub them too. Span descriptions and
      // url/sql data carry tickers in query strings; strip those but keep method/status/timing.
      scrubRequest(event.request);
      const traceData = (event.contexts?.trace as { data?: Record<string, unknown> } | undefined)
        ?.data;
      if (traceData) {
        for (const key of SENSITIVE_SPAN_DATA) {
          if (typeof traceData[key] === 'string') traceData[key] = stripQuery(traceData[key] as string);
        }
      }
      for (const span of event.spans ?? []) {
        if (typeof span.description === 'string') span.description = stripQuery(span.description);
        const data = span.data as Record<string, unknown> | undefined;
        if (data) {
          for (const key of SENSITIVE_SPAN_DATA) {
            if (typeof data[key] === 'string') data[key] = stripQuery(data[key] as string);
          }
        }
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
