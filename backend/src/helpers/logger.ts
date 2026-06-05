import fs from 'fs';
import path from 'path';

/**
 * Central logger — the single choke point for backend diagnostics.
 *
 * Every call fans out to four places:
 *   1. the console (so dev/Electron stdout keeps the existing `[component] message` lines),
 *   2. a size-rotated file under LOG_DIR (survives a restart; the durable, offline record),
 *   3. an in-memory ring buffer (served by GET /api/diagnostics, mirrors rateLimitMonitor),
 *   4. a pluggable remote sink (Electron injects a Sentry-backed one; no-op in dev/tests).
 *
 * The backend never imports Electron or Sentry: the remote sink is injected via
 * `setRemoteSink()`. Logging is best-effort — file/sink failures are swallowed so a
 * logging problem can never crash a request.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RecentEvent {
  ts: string; // ISO8601
  level: LogLevel;
  component: string; // e.g. 'yahooPrice', 'fx', 'error'
  message: string;
  errorName?: string; // set when an Error was passed (no Error object is retained)
}

export type RemoteSink = (event: RecentEvent, err?: unknown) => void;

const MAX_FILE_BYTES = 2 * 1024 * 1024; // rotate once app.log passes 2 MB
const MAX_FILES = 3; // app.log + app.1.log + app.2.log
const RING_SIZE = 500;
const LOG_FILE_NAME = 'app.log';

const ring: RecentEvent[] = [];
const ensuredDirs = new Set<string>();
let remoteSink: RemoteSink | null = null;

/**
 * Resolve the log directory fresh on each write: tests repoint LOG_DIR per file and the
 * Electron main process sets `${userData}/logs` before the first log. Mirrors db.ts's
 * env-first / dev-fallback resolution (dist & tsx both land on `backend/logs`).
 */
function logDir(): string {
  return process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');
}

/** Absolute path of the active log file (for the diagnostics payload). */
export function getLogFilePath(): string {
  return path.join(logDir(), LOG_FILE_NAME);
}

function ensureDir(dir: string): void {
  if (ensuredDirs.has(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  ensuredDirs.add(dir);
}

/**
 * Rotate `app.log → app.1.log → app.2.log` (oldest dropped) once the active file passes
 * the size cap. The oldest is removed first so each rename targets a free name — keeps
 * rotation cross-platform (Windows renameSync throws if the destination exists).
 */
function rotateIfNeeded(dir: string, file: string): void {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return; // no file yet → nothing to rotate
  }
  if (size < MAX_FILE_BYTES) return;

  try {
    const oldest = path.join(dir, `app.${MAX_FILES - 1}.log`);
    if (fs.existsSync(oldest)) fs.rmSync(oldest);
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? file : path.join(dir, `app.${i - 1}.log`);
      const dst = path.join(dir, `app.${i}.log`);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
  } catch {
    /* best-effort: a locked file just keeps appending to the current app.log */
  }
}

function appendToFile(ev: RecentEvent, err?: unknown): void {
  const dir = logDir();
  const file = path.join(dir, LOG_FILE_NAME);
  ensureDir(dir);
  rotateIfNeeded(dir, file);
  let line = `${ev.ts} ${ev.level.toUpperCase()} [${ev.component}] ${ev.message}\n`;
  if (err instanceof Error && err.stack) line += `${err.stack}\n`;
  fs.appendFileSync(file, line);
}

function pushRing(ev: RecentEvent): void {
  ring.push(ev);
  if (ring.length > RING_SIZE) ring.shift();
}

/** Newest-last copy of the recent events (bounded to RING_SIZE). */
export function getRecentEvents(): RecentEvent[] {
  return ring.slice();
}

/** Inject a remote sink (Electron does this after Sentry.init). No-op in dev/tests/no-DSN. */
export function setRemoteSink(fn: RemoteSink | null): void {
  remoteSink = fn;
}

function emit(level: LogLevel, component: string, message: string, err?: unknown): void {
  const ev: RecentEvent = { ts: new Date().toISOString(), level, component, message };
  if (err instanceof Error) ev.errorName = err.name;

  // 1) Preserve console output (unchanged dev/Electron stdout, same [component] format).
  const line = `[${component}] ${message}`;
  if (level === 'error') console.error(line, err ?? '');
  else if (level === 'warn') console.warn(line);
  else if (level === 'info') console.log(line);
  else console.debug(line);

  // 2) Persistent file — best-effort; logging must never crash the app.
  try {
    appendToFile(ev, err);
  } catch {
    /* ignore */
  }

  // 3) In-memory ring buffer.
  pushRing(ev);

  // 4) Remote sink (Sentry in prod; no-op otherwise).
  if (remoteSink) {
    try {
      remoteSink(ev, err);
    } catch {
      /* ignore */
    }
  }
}

export const logger = {
  debug: (component: string, message: string): void => emit('debug', component, message),
  info: (component: string, message: string): void => emit('info', component, message),
  warn: (component: string, message: string): void => emit('warn', component, message),
  error: (component: string, message: string, err?: unknown): void =>
    emit('error', component, message, err),
};

/** Test-only: clear the ring buffer (mirror _resetRateLimitMonitor). */
export function _resetLogBuffer(): void {
  ring.length = 0;
}
