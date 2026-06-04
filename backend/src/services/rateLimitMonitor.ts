import { PRICE_CACHE_TTL_SECONDS } from '../helpers/constants';

/**
 * In-memory rate-limit monitor for the external market-data providers.
 *
 * The providers swallow upstream errors (log + return null/[]) so the app keeps
 * serving cached/stale data. This monitor records *why* data went stale — a 429 /
 * "Too Many Requests" — so the UI can show a banner.
 *
 * We don't know the providers' real rate-limit window (Yahoo's 429 comes from its
 * edge/CDN and is undocumented; Frankfurter/ECB has none). So instead of guessing a
 * cooldown, the state clears on *evidence of recovery*: a provider is "limited" while
 * its most recent 429 is newer than its most recent successful live call. A TTL-derived
 * ceiling (MAX_AGE_MS) is only a safety net so the banner can't stick forever if no live
 * call ever follows the 429.
 */

export type ProviderId = 'yahoo' | 'frankfurter';

// Safety net: if no live call follows a 429, assume the limit has passed after this.
// Derived from the live-quote cache TTL (the app re-attempts live calls at that cadence),
// doubled as a margin — not a guess at the provider's opaque window.
const MAX_AGE_MS = 2 * PRICE_CACHE_TTL_SECONDS * 1000; // 10 min

const lastLimited = new Map<ProviderId, number>();
const lastOk = new Map<ProviderId, number>();

/** Record that a provider just returned a rate-limit (429). */
export function markLimited(provider: ProviderId): void {
  lastLimited.set(provider, Date.now());
}

/** Record that a *live* provider call just succeeded (clears a prior limit). */
export function markRecovered(provider: ProviderId): void {
  lastOk.set(provider, Date.now());
}

/**
 * Providers still considered rate-limited: their latest 429 is at least as recent as
 * their latest successful call, and within the safety net. The `>=` means a 429 wins a
 * same-millisecond tie (e.g. a parallel batch where one call succeeds and one 429s) — we
 * prefer to keep showing the warning; the next successful call clears it.
 */
export function getActiveLimited(): ProviderId[] {
  const now = Date.now();
  const out: ProviderId[] = [];
  for (const [provider, limitedAt] of lastLimited) {
    if (limitedAt >= (lastOk.get(provider) ?? 0) && now - limitedAt < MAX_AGE_MS) {
      out.push(provider);
    }
  }
  return out;
}

/**
 * True when `err` looks like an upstream rate-limit (HTTP 429).
 * yahoo-finance2 v3 HTTPError puts the status on `.code` (not `.status`) with the raw
 * response body as message; Frankfurter throws `Error("Frankfurter 429 on ...")`.
 * Matching the number 429 (not the string codes like "ETIMEDOUT") avoids false positives.
 */
export function isRateLimitError(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown };
  const status = e.code ?? e.status ?? e.statusCode;
  if (status === 429 || status === '429') return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('too many requests') || msg.includes('429') || msg.includes('rate limit');
}

/** Test-only: reset all recorded state. */
export function _resetRateLimitMonitor(): void {
  lastLimited.clear();
  lastOk.clear();
}
