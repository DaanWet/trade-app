import { yahoo } from '../yahooClient';
import { isRateLimitError, markLimited, markRecovered } from '../rateLimitMonitor';
import { recordFailure, recordSuccess } from '../providerHealth';
import { logger } from '../../helpers/logger';
import { errorMessage } from '../../helpers/errors';
import { fetchQuoteViaChart } from './chartQuote';
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

  /**
   * Live quote, with the crumb-free chart endpoint as a fallback.
   *
   * `quote()` is the only call here that needs a crumb, and the crumb handshake breaks on
   * some machines for weeks on end (see chartQuote.ts). Its failure is therefore a handled
   * condition, not an outage: it is logged at debug level per symbol, while providerHealth
   * escalates the *streak* once so it still reaches Sentry. Only when both endpoints fail
   * does this count as a real failure to price the position.
   */
  async fetchQuote(symbol) {
    const sym = symbol.toUpperCase();
    let quoteFailure: string;

    try {
      const q = await yahoo.quote(sym);
      markRecovered('yahoo');
      if (q?.regularMarketPrice != null) {
        recordSuccess('yahoo', 'quote');
        recordSuccess('yahoo', 'fetchQuote');
        const result: PriceQuote = {
          symbol: sym,
          name: q.longName ?? q.shortName ?? null,
          currency: q.currency ?? null,
          last_price: q.regularMarketPrice,
          exchange: q.fullExchangeName ?? q.exchange ?? null,
          quote_type: q.quoteType ?? null,
        };
        return result;
      }
      quoteFailure = q ? 'quote returned no price' : 'quote returned nothing';
    } catch (err) {
      if (isRateLimitError(err)) markLimited('yahoo');
      quoteFailure = errorMessage(err);
    }

    logger.debug('yahooPrice', `quote(${sym}) unusable: ${quoteFailure} — trying chart()`);
    recordFailure('yahoo', 'quote', quoteFailure);

    try {
      const viaChart = await fetchQuoteViaChart(sym);
      markRecovered('yahoo');
      if (viaChart) {
        recordSuccess('yahoo', 'fetchQuote');
        return viaChart;
      }
      recordFailure('yahoo', 'fetchQuote', quoteFailure);
      return null;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('yahoo');
      const chartFailure = errorMessage(err);
      logger.warn(
        'yahooPrice',
        `fetchQuote(${sym}) failed: ${quoteFailure} (chart fallback: ${chartFailure})`,
      );
      recordFailure('yahoo', 'fetchQuote', chartFailure);
      return null;
    }
  },

  async fetchHistorical(symbol, from, to) {
    const sym = symbol.toUpperCase();
    try {
      const result = await yahoo.chart(sym, { period1: from, period2: to, interval: '1d' });
      markRecovered('yahoo');
      recordSuccess('yahoo', 'fetchHistorical');
      const out: PriceClose[] = [];
      for (const q of result.quotes ?? []) {
        if (q.close != null && q.date != null) {
          out.push({ date: q.date.toISOString().slice(0, 10), close: q.close });
        }
      }
      return out;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('yahoo');
      const message = errorMessage(err);
      logger.warn('yahooPrice', `fetchHistorical(${sym}) failed: ${message}`);
      recordFailure('yahoo', 'fetchHistorical', message);
      return [];
    }
  },

  async search(query) {
    if (!query.trim()) return [];
    try {
      const result = await yahoo.search(query, { quotesCount: 10, newsCount: 0 });
      markRecovered('yahoo');
      recordSuccess('yahoo', 'search');
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
      const message = errorMessage(err);
      logger.warn('yahooPrice', `search(${query}) failed: ${message}`);
      recordFailure('yahoo', 'search', message);
      return [];
    }
  },
};
