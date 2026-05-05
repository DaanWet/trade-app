import {
  getTicker,
  upsertTicker,
  listTickers,
  type TickerRow,
  upsertDailyPrice,
  listDailyPricesInRange,
  getMostRecentDailyPrice,
} from '../queries/prices';
import { PRICE_CACHE_TTL_SECONDS } from '../helpers/constants';
import { priceProvider } from './providers';
import type { SymbolSearchResult } from './providers/types';

/**
 * Live + historical price service.
 *
 *  - Live quotes go through the `tickers` table with a 5-minute TTL.
 *  - Historical daily closes are cached in `daily_prices` and forward-filled
 *    so portfolio-history walks become pure cache hits.
 *  - All actual external calls go through the configured `priceProvider`.
 */

function isFresh(lastPriceAt: string | null): boolean {
  if (!lastPriceAt) return false;
  const ageSeconds = (Date.now() - new Date(lastPriceAt).getTime()) / 1000;
  return ageSeconds < PRICE_CACHE_TTL_SECONDS;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch current quote for one ticker, using cache when fresh.
 */
export async function fetchQuote(symbol: string, opts?: { force?: boolean }): Promise<TickerRow | null> {
  const sym = symbol.toUpperCase();
  const cached = getTicker(sym);
  if (!opts?.force && cached && isFresh(cached.last_price_at)) return cached;

  const q = await priceProvider.fetchQuote(sym);
  if (!q) return cached;

  upsertTicker({
    symbol: sym,
    name: q.name,
    currency: q.currency,
    last_price: q.last_price,
    last_price_at: new Date().toISOString(),
    exchange: q.exchange,
    quote_type: q.quote_type,
  });
  return getTicker(sym);
}

/**
 * Fetch quotes for many tickers in parallel (cache-aware).
 */
export async function fetchQuotes(symbols: string[], opts?: { force?: boolean }): Promise<TickerRow[]> {
  const unique = Array.from(new Set(symbols.map(s => s.toUpperCase())));
  await Promise.all(unique.map(s => fetchQuote(s, opts)));
  return listTickers(unique);
}

export async function searchSymbol(query: string): Promise<SymbolSearchResult[]> {
  return priceProvider.search(query);
}

/**
 * Daily closes for a date range, served from cache where possible.
 *
 *  - On full cache hit (range fully populated and `to` is past): no provider call.
 *  - On partial cache or `to >= today`: one provider call for the full range,
 *    cached and forward-filled.
 */
export async function fetchHistorical(
  symbol: string,
  from: Date,
  to: Date = new Date(),
): Promise<Array<{ date: string; close: number }>> {
  const sym = symbol.toUpperCase();
  const fromIso = isoDate(from);
  const toIso = isoDate(to);
  const today = isoDate(new Date());

  const cached = listDailyPricesInRange(sym, fromIso, toIso);
  // We trust the cache when:
  //  - it has at least one entry, AND
  //  - it covers up to either `to` or yesterday (today's value is volatile, refetch if requested)
  const cacheGoodEnough =
    cached.length > 0 &&
    (toIso < today || cached.some(c => c.price_date === today));

  if (cacheGoodEnough) {
    return cached.map(c => ({ date: c.price_date, close: c.close }));
  }

  // Cache miss / partial → ask the provider for the full range and (re)populate.
  const fresh = await priceProvider.fetchHistorical(sym, from, to);
  for (const p of fresh) {
    upsertDailyPrice({ symbol: sym, price_date: p.date, close: p.close });
  }
  forwardFillDailyPrices(sym, from, to);
  return listDailyPricesInRange(sym, fromIso, toIso).map(c => ({ date: c.price_date, close: c.close }));
}

/**
 * Fill every day in [from, to] with a close, carrying forward the previous trading day's
 * value across weekends/holidays. Resolution order matches FX forward-fill.
 */
function forwardFillDailyPrices(symbol: string, from: Date, to: Date): void {
  const fromIso = isoDate(from);
  const toIso = isoDate(to);
  const cached = listDailyPricesInRange(symbol, fromIso, toIso);
  const byDate = new Map(cached.map(r => [r.price_date, r.close]));

  let lastClose: number;
  if (cached.length > 0) {
    lastClose = cached[0].close;
  } else {
    const fallback = getMostRecentDailyPrice(symbol);
    if (!fallback) return; // No data at all — nothing to fill with.
    lastClose = fallback.close;
  }

  const cursor = new Date(from);
  while (cursor <= to) {
    const day = isoDate(cursor);
    const known = byDate.get(day);
    if (known != null) {
      lastClose = known;
    } else {
      upsertDailyPrice({ symbol, price_date: day, close: lastClose });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

/**
 * Get the close price for a symbol on a specific date.
 *  - If `date` is today (or in the future), uses the live quote.
 *  - Otherwise looks up the daily-close cache (refreshing on miss).
 *  - Returns null if no price could be obtained.
 */
export async function priceAt(
  symbol: string,
  date: string,
): Promise<{ price: number; currency: string | null; date: string } | null> {
  const today = isoDate(new Date());
  const target = new Date(date);
  if (isNaN(target.getTime())) return null;

  if (date >= today) {
    const q = await fetchQuote(symbol);
    if (!q?.last_price) return null;
    return { price: q.last_price, currency: q.currency, date: today };
  }

  const from = new Date(target);
  from.setDate(from.getDate() - 7);
  const to = new Date(target);
  to.setDate(to.getDate() + 1);
  const closes = await fetchHistorical(symbol, from, to);
  const onOrBefore = closes.filter(c => c.date <= date);
  const pick = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : closes[closes.length - 1];
  if (!pick) return null;

  const cached = getTicker(symbol);
  const currency = cached?.currency ?? (await fetchQuote(symbol))?.currency ?? null;
  return { price: pick.close, currency, date: pick.date };
}
