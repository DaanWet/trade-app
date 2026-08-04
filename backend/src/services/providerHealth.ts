import { logger } from '../helpers/logger';

/**
 * Consecutive-failure tracker for the external market-data providers.
 *
 * The providers swallow upstream errors on purpose (log + return null/[]) so the app keeps
 * serving cached data instead of erroring out. The cost of that choice is silence: a single
 * `logger.warn` per failure becomes a Sentry *breadcrumb*, and breadcrumbs only travel
 * alongside a captured error. A provider that is broken for weeks therefore produced no
 * remote signal at all — the first report came from a user, not from the app.
 *
 * This module fixes that without turning every network blip into an alert: incidental
 * failures stay warnings, but once the same operation fails `ESCALATE_AFTER` times in a row
 * it is logged once at error level (→ Sentry). The counter also feeds /api/diagnostics, so
 * a local log inspection shows immediately which provider call is dead.
 *
 * Counters are per provider *and* operation: on the crumb outage `quote()` was broken while
 * `chart()` was fine, and collapsing those into one number would have hidden exactly that.
 */

/** Failures in a row before an operation is considered broken rather than flaky. */
export const ESCALATE_AFTER = 3;

const consecutive = new Map<string, number>();
const escalated = new Set<string>();

function keyOf(provider: string, operation: string): string {
  return `${provider}.${operation}`;
}

/**
 * Record one failed provider call. Escalates to error level exactly once per outage —
 * re-escalation waits for a success (which clears the state) so a permanently broken
 * endpoint can't flood the sink.
 */
export function recordFailure(provider: string, operation: string, message: string): void {
  const key = keyOf(provider, operation);
  const count = (consecutive.get(key) ?? 0) + 1;
  consecutive.set(key, count);

  if (count >= ESCALATE_AFTER && !escalated.has(key)) {
    escalated.add(key);
    logger.error(
      'providerHealth',
      `${provider} ${operation} failed ${count}x in a row; latest: ${message}`,
    );
  }
}

/** Record a successful live call — clears the streak and re-arms escalation. */
export function recordSuccess(provider: string, operation: string): void {
  const key = keyOf(provider, operation);
  consecutive.delete(key);
  escalated.delete(key);
}

/** Current consecutive-failure count per `provider.operation` (for /api/diagnostics). */
export function getProviderFailures(): Record<string, number> {
  return Object.fromEntries(consecutive);
}

/** Test-only: reset all recorded state. */
export function _resetProviderHealth(): void {
  consecutive.clear();
  escalated.clear();
}
