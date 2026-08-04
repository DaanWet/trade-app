import { isRateLimitError, markLimited, markRecovered } from '../rateLimitMonitor';
import { recordFailure, recordSuccess } from '../providerHealth';
import { logger } from '../../helpers/logger';
import { errorMessage } from '../../helpers/errors';
import type { FxProvider, FxRangePoint } from './types';

/**
 * Frankfurter (https://www.frankfurter.app) — free, key-less FX provider built
 * on top of the European Central Bank's reference rates.
 *
 *  - No API key, no rate limit.
 *  - ECB publishes once per business day; weekends/holidays return no data.
 *  - Cross-rates are computed by Frankfurter when neither leg is EUR.
 */

const BASE_URL = 'https://api.frankfurter.dev/v1';

interface FrankfurterLatestResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface FrankfurterRangeResponse {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Frankfurter ${res.status} on ${url}`);
  return (await res.json()) as T;
}

/**
 * A 404 means "the ECB doesn't publish this pair" (TWD, KRW, …), not "the provider is
 * broken" — the composite provider then falls back to Yahoo, which is the designed path.
 * Counting those as failures would keep the health monitor permanently red for anyone
 * holding such a currency, and drown the real signal.
 */
function isNoDataError(err: unknown): boolean {
  return /Frankfurter 404 /.test(errorMessage(err));
}

export const frankfurterProvider: FxProvider = {
  name: 'frankfurter',

  async fetchRate(base, quote, date) {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    if (b === q) return 1;

    const today = new Date().toISOString().slice(0, 10);
    const path = date >= today ? '/latest' : `/${date}`;
    const url = `${BASE_URL}${path}?base=${b}&symbols=${q}`;
    try {
      const data = await getJson<FrankfurterLatestResponse>(url);
      markRecovered('frankfurter');
      recordSuccess('frankfurter', 'fetchRate');
      return data.rates?.[q] ?? null;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('frankfurter');
      const message = errorMessage(err);
      logger.warn('frankfurter', `fetchRate ${b}/${q}@${date} failed: ${message}`);
      if (!isNoDataError(err)) recordFailure('frankfurter', 'fetchRate', message);
      return null;
    }
  },

  async fetchRange(base, quote, from, to) {
    const b = base.toUpperCase();
    const q = quote.toUpperCase();
    if (b === q) return [];

    const url = `${BASE_URL}/${isoDate(from)}..${isoDate(to)}?base=${b}&symbols=${q}`;
    try {
      const data = await getJson<FrankfurterRangeResponse>(url);
      markRecovered('frankfurter');
      recordSuccess('frankfurter', 'fetchRange');
      const points: FxRangePoint[] = [];
      for (const [date, rates] of Object.entries(data.rates ?? {})) {
        const r = rates[q];
        if (r != null) points.push({ date, rate: r });
      }
      points.sort((a, b) => a.date.localeCompare(b.date));
      return points;
    } catch (err) {
      if (isRateLimitError(err)) markLimited('frankfurter');
      const message = errorMessage(err);
      logger.warn('frankfurter', `fetchRange ${b}/${q} failed: ${message}`);
      if (!isNoDataError(err)) recordFailure('frankfurter', 'fetchRange', message);
      return [];
    }
  },
};
