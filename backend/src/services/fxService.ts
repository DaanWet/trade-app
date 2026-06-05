import {
  getFxRate,
  upsertFxRate,
  getMostRecentFxRate,
  listFxRatesInRange,
  type FxRateRow,
} from '../queries/prices';
import { fxProvider } from './providers';
import { logger } from '../helpers/logger';

/**
 * FX service — reads cached rates first, asks the configured FxProvider only on misses.
 *
 *  - Past dates are immutable; today's rate is fetched once per calendar day.
 *  - `convert()` is non-throwing: if no rate can be obtained, returns the input
 *    unchanged so dashboards stay readable.
 *  - `warmHistoricalRates()` pre-populates a date range with one provider call per
 *    pair, then forward-fills missing days. After this, every `convert()` in the
 *    range is a pure cache hit.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getRate(base: string, quote: string, date: string = todayIso()): Promise<number> {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;

  const cached = getFxRate(b, q, date);
  if (cached) return cached.rate;

  const fetched = await fxProvider.fetchRate(b, q, date);
  if (fetched != null) {
    upsertFxRate({ base: b, quote: q, rate_date: date, rate: fetched });
    return fetched;
  }

  const fallback = getMostRecentFxRate(b, q);
  if (fallback) {
    logger.warn('fx', `Stale fallback rate for ${b}/${q}: ${fallback.rate} from ${fallback.rate_date}`);
    return fallback.rate;
  }

  throw new Error(`No FX rate available for ${b}/${q} on ${date}`);
}

let _convertFailures = 0;
export async function convert(amount: number, from: string, to: string, date?: string): Promise<number> {
  if (amount === 0) return 0;
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  try {
    const rate = await getRate(from, to, date);
    return amount * rate;
  } catch {
    _convertFailures++;
    // Leave a breadcrumb without warn-spam: convert() is intentionally non-throwing.
    logger.debug('fx', `convert ${from}->${to} failed, returning unconverted amount`);
    return amount;
  }
}

export function lastConvertFailures(): number {
  return _convertFailures;
}

/** Quick warm of "today" rates for a small set of pairs (settings page, etc.). */
export async function warmRates(pairs: Array<{ from: string; to: string }>): Promise<void> {
  await Promise.all(pairs.map(p => getRate(p.from, p.to).catch(() => null)));
}

/**
 * Pre-fetch a historical FX range for each pair (one provider call per pair),
 * then forward-fill so every day in [from, to] has a rate. Subsequent convert()
 * calls hit the cache instead of the provider.
 */
export async function warmHistoricalRates(
  pairs: Array<{ from: string; to: string }>,
  from: Date,
  to: Date,
): Promise<void> {
  await Promise.all(
    pairs.map(async ({ from: base, to: quote }) => {
      const b = base.toUpperCase();
      const q = quote.toUpperCase();
      if (b === q) return;

      const padStart = new Date(from);
      padStart.setDate(padStart.getDate() - 7);
      const points = await fxProvider.fetchRange(b, q, padStart, to);
      for (const p of points) {
        upsertFxRate({ base: b, quote: q, rate_date: p.date, rate: p.rate });
      }
      forwardFillRates(b, q, from, to);
    }),
  );
}

/**
 * Fill every day in [from, to] with a rate, carrying forward the most recent
 * known value. Resolution order:
 *   1. Earliest cached rate within the range (forward-filled from there)
 *   2. Most recent cached rate from any prior date
 *   3. Last resort: 1.0 (degraded — dashboard renders, numbers may be wrong)
 */
function forwardFillRates(base: string, quote: string, from: Date, to: Date): void {
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const cached = listFxRatesInRange(base, quote, fromIso, toIso);
  const byDate = new Map(cached.map(r => [r.rate_date, r.rate]));

  let lastRate: number;
  if (cached.length > 0) {
    lastRate = cached[0].rate;
  } else {
    const fallback = getMostRecentFxRate(base, quote);
    if (fallback) {
      lastRate = fallback.rate;
    } else {
      logger.warn('fx', `No rate available for ${base}/${quote}; defaulting to 1.0 for [${fromIso}, ${toIso}]`);
      lastRate = 1.0;
    }
  }

  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.toISOString().slice(0, 10);
    const known = byDate.get(day);
    if (known != null) {
      lastRate = known;
    } else {
      upsertFxRate({ base, quote, rate_date: day, rate: lastRate });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

export type { FxRateRow };
