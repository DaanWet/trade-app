import { yahoo } from '../yahooClient';
import type { PriceQuote } from './types';

/**
 * Live quote via Yahoo's chart endpoint — the crumb-free route to the same price.
 *
 * Yahoo's `/v7/finance/quote` requires a crumb token, and yahoo-finance2 can only obtain one
 * by walking Yahoo's EU cookie-consent flow with a hard-coded sequence of expected redirects.
 * When Yahoo answers that flow differently (e.g. bouncing straight back to the quote page
 * with `?guccounter=1` instead of `collectConsent`), the library throws and *every* quote
 * fails — indefinitely, per machine, with no version of the library behaving differently.
 *
 * `/v8/finance/chart` needs no crumb, and its `meta` block carries the same live price,
 * currency, name, exchange and instrument type. So when the quote endpoint is unreachable we
 * read the price off the chart response instead of showing a frozen number.
 *
 * Throws on transport errors (per the PriceProvider contract) — callers wrap it.
 */

/** Enough calendar days to always span a weekend plus a public holiday or two. */
const LOOKBACK_DAYS = 7;

export async function fetchQuoteViaChart(symbol: string): Promise<PriceQuote | null> {
  const sym = symbol.toUpperCase();
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - LOOKBACK_DAYS);

  const result = await yahoo.chart(sym, { period1: from, period2: to, interval: '1d' });
  const meta = result?.meta;
  if (!meta) return null;

  const closes = (result.quotes ?? []).map(q => q.close).filter((c): c is number => c != null);
  // `regularMarketPrice` is the live figure; the last candle close is the fallback for
  // instruments whose meta omits it (and matches what the history cache would show).
  const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  if (price == null) return null;

  // The previous session's close is the candle *before* the last one: during a session the
  // last candle is today (still moving), and outside one it is the session just closed —
  // both make its predecessor the right baseline for a day move. `meta.previousClose` is
  // the fallback; `meta.chartPreviousClose` deliberately is not, as it sits before the whole
  // requested range (a week ago here), not before the last session.
  const previousClose = closes.length >= 2 ? closes[closes.length - 2] : (meta.previousClose ?? null);

  return {
    symbol: sym,
    name: meta.longName ?? meta.shortName ?? null,
    currency: meta.currency ?? null,
    last_price: price,
    previous_close: previousClose,
    exchange: meta.fullExchangeName ?? null,
    quote_type: meta.instrumentType ?? null,
  };
}
