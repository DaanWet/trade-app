import { yahoo } from '../yahooClient';
import { isRateLimitError, markLimited, markRecovered } from '../rateLimitMonitor';
import type { NewsItem } from './types';

/**
 * Ticker news from Yahoo's search endpoint.
 *
 * Searching by symbol alone is unreliable: `KBC.BR` returns no news while `KBC Group`
 * does, and a short symbol like `CAS` returns articles about unrelated "CAS" companies.
 * So we query by symbol *and* company name, and keep only items Yahoo itself tags with
 * the symbol in `relatedTickers` — the one relevance rule that holds for both cases.
 */

const NEWS_PER_QUERY = 10;

const HTTP_URL = /^https?:\/\//i;

/** Trailing legal-form tokens; with them Yahoo's news search misses (`KBC Group NV` → 0). */
const LEGAL_SUFFIXES = new Set([
  'nv', 'n.v.', 'sa', 's.a.', 'ag', 'se', 'asa', 'ab', '(publ)', 'plc',
  'inc', 'inc.', 'corp', 'corp.', 'corporation', 'co.', 'ltd', 'ltd.', 'limited',
]);

export function cleanCompanyName(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(' ').replace(/[,\s]+$/, '');
}

interface YahooNewsRaw {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: Date | number | string;
  relatedTickers?: string[];
}

function toNewsItem(raw: YahooNewsRaw, symbol: string): NewsItem | null {
  const related = (raw.relatedTickers ?? []).map((t) => t.toUpperCase());
  if (!related.includes(symbol)) return null;
  if (!raw.uuid || !raw.title || !raw.link || raw.providerPublishTime == null) return null;
  // The UI hands links to the OS browser: anything but http(s) (file:, ms-msdt:, …) is dropped.
  if (!HTTP_URL.test(raw.link)) return null;
  const published = new Date(raw.providerPublishTime);
  if (isNaN(published.getTime())) return null;
  return {
    id: raw.uuid,
    title: raw.title,
    publisher: raw.publisher ?? null,
    url: raw.link,
    published_at: published.toISOString(),
    source: 'yahoo',
  };
}

/**
 * Throws when every query failed, so the caller can count it as a provider failure, and at
 * once when the symbol query is rate limited (no point querying the name too).
 */
export async function fetchTickerNews(symbol: string, name: string | null): Promise<NewsItem[]> {
  const sym = symbol.toUpperCase();
  const queries = [sym];
  const cleaned = name ? cleanCompanyName(name) : '';
  if (cleaned && cleaned.toUpperCase() !== sym) queries.push(cleaned);

  const byId = new Map<string, NewsItem>();
  let lastError: unknown = null;
  let failures = 0;
  for (const query of queries) {
    let raws: YahooNewsRaw[];
    try {
      const result = await yahoo.search(query, { quotesCount: 0, newsCount: NEWS_PER_QUERY });
      markRecovered('yahoo');
      raws = (result.news ?? []) as YahooNewsRaw[];
    } catch (err) {
      if (isRateLimitError(err)) {
        markLimited('yahoo');
        // The name query would hit the same wall: rethrow so the round can back off too.
        // (A limit on the name query keeps what the symbol query already found.)
        if (query === sym) throw err;
      }
      lastError = err;
      failures++;
      continue;
    }
    for (const raw of raws) {
      const item = toNewsItem(raw, sym);
      if (item && !byId.has(item.id)) byId.set(item.id, item);
    }
  }
  if (failures === queries.length) throw lastError;
  return [...byId.values()];
}
