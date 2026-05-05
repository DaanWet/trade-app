import { yahoo } from '../yahooClient';
import type { FxProvider, FxRangePoint } from './types';

/**
 * Yahoo Finance FX provider — kept as a fallback. Less accurate / more rate-limited
 * than Frankfurter (ECB) for currency conversion. Uses Yahoo's "EURUSD=X"-style FX symbols.
 */
export const yahooFxProvider: FxProvider = {
  name: 'yahoo',

  async fetchRate(base, quote, date) {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    if (b === q) return 1;
    const symbol = `${b}${q}=X`;
    const today = new Date().toISOString().slice(0, 10);

    try {
      if (date >= today) {
        const r = await yahoo.quote(symbol);
        return r?.regularMarketPrice ?? null;
      }
      const target = new Date(date);
      const from = new Date(target);
      from.setDate(from.getDate() - 5);
      const to = new Date(target);
      to.setDate(to.getDate() + 1);
      const result = await yahoo.chart(symbol, { period1: from, period2: to, interval: '1d' });
      const candles = (result.quotes ?? []).filter(q => q.close != null);
      if (candles.length === 0) return null;
      const onOrBefore = candles.filter(c => c.date && c.date <= target);
      const pick = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : candles[candles.length - 1];
      return (pick.close as number) ?? null;
    } catch (err) {
      console.warn(`[yahooFx] fetchRate ${symbol}@${date} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  },

  async fetchRange(base, quote, from, to) {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    if (b === q) return [];
    const symbol = `${b}${q}=X`;
    try {
      const result = await yahoo.chart(symbol, { period1: from, period2: to, interval: '1d' });
      const points: FxRangePoint[] = [];
      for (const candle of result.quotes ?? []) {
        if (candle.close != null && candle.date != null) {
          points.push({ date: candle.date.toISOString().slice(0, 10), rate: candle.close });
        }
      }
      return points;
    } catch (err) {
      console.warn(`[yahooFx] fetchRange ${symbol} failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  },
};
