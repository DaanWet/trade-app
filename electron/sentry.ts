import * as Sentry from '@sentry/electron/main';
import { scrubBreadcrumb, scrubRequest, scrubSpanData, scrubText, stripQuery } from './scrub';

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
      for (const b of event.breadcrumbs ?? []) scrubBreadcrumb(b);
      return event;
    },
    beforeSendTransaction: (event) => {
      // Transactions/spans bypass beforeSend — scrub them too. Span descriptions and
      // url/sql data carry tickers in query strings; strip those but keep method/status/timing.
      scrubRequest(event.request);
      scrubSpanData((event.contexts?.trace as { data?: Record<string, unknown> } | undefined)?.data);
      for (const span of event.spans ?? []) {
        if (typeof span.description === 'string') span.description = stripQuery(span.description);
        scrubSpanData(span.data as Record<string, unknown> | undefined);
      }
      // Transactions carry the scope's breadcrumbs too (fetch URLs, console arguments).
      for (const b of event.breadcrumbs ?? []) scrubBreadcrumb(b);
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
