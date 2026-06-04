import { yahoo } from '../yahooClient';
import { isRateLimitError, markLimited, markRecovered } from '../rateLimitMonitor';
import type {
  PriceProvider,
  PriceQuote,
  PriceClose,
  SymbolSearchResult,
} from './types';

/**
 * Yahoo Finance price provider. Default for stock prices in this app.
 *
 * Caveats: Yahoo data has occasional gaps/glitches and is rate-limited.
 * Caching (in `daily_prices`) and a 5-minute live-quote cache mitigate this.
 */
export const yahooPriceProvider: PriceProvider = {
  name: 'yahoo',

  async fetchQuote(symbol) {
    const sym = symbol.toUpperCase();
    try {
      const q = await yahoo.quote(sym);
      markRecovered('yahoo');
      if (!q) return null;
      const result: PriceQuote = {
        symbol: sym,
        name: q.longName ?? q.shortName ?? null,
        currency: q.currency ?? null,
        last_price: q.regularMarketPrice ?? null,
        exchange: q.fullExchangeName ?? q.exchange ?? null,
        quote_type: q.quoteType ?? null,
      };
      return result;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('yahoo');
      console.warn(`[yahooPrice] fetchQuote(${sym}) failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  },

  async fetchHistorical(symbol, from, to) {
    const sym = symbol.toUpperCase();
    try {
      const result = await yahoo.chart(sym, { period1: from, period2: to, interval: '1d' });
      markRecovered('yahoo');
      const out: PriceClose[] = [];
      for (const q of result.quotes ?? []) {
        if (q.close != null && q.date != null) {
          out.push({ date: q.date.toISOString().slice(0, 10), close: q.close });
        }
      }
      return out;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('yahoo');
      console.warn(`[yahooPrice] fetchHistorical(${sym}) failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  },

  async search(query) {
    if (!query.trim()) return [];
    try {
      const result = await yahoo.search(query, { quotesCount: 10, newsCount: 0 });
      markRecovered('yahoo');
      const out: SymbolSearchResult[] = [];
      for (const raw of result.quotes ?? []) {
        const q = raw as Partial<Record<'symbol' | 'longname' | 'shortname' | 'exchange' | 'quoteType', string>>;
        if (!q.symbol) continue;
        out.push({
          symbol: q.symbol,
          name: q.longname || q.shortname || q.symbol,
          exchange: q.exchange ?? '',
          quoteType: q.quoteType ?? '',
        });
      }
      return out;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('yahoo');
      console.warn(`[yahooPrice] search(${query}) failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  },
};
