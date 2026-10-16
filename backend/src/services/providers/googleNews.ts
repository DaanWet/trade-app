import { XMLParser } from 'fast-xml-parser';
import type { NewsItem } from './types';

/**
 * Keyword news from Google News RSS (Belgian Dutch edition, last 7 days).
 *
 * Yahoo's search is weak for free keywords (weeks-old hits), so keywords go here.
 * Each item has a title (suffixed " - <source>"), a news.google.com redirect link, a
 * guid, a pubDate and a <source>; there is no article body.
 */

const MAX_ITEMS = 20;

/** A stalled request would otherwise block the sequential refresh round for undici's 300 s. */
const FETCH_TIMEOUT_MS = 15_000;

const HTTP_URL = /^https?:\/\//i;

const parser = new XMLParser({
  // A title like "2026" must stay a string. Attributes (guid isPermaLink, source url) are
  // dropped by default, which turns <guid>/<source> into plain text.
  parseTagValue: false,
  // A channel with one item must still parse to an array.
  isArray: (name) => name === 'item',
});

interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  source?: string;
}

export function googleNewsUrl(keyword: string): string {
  const q = encodeURIComponent(`${keyword} when:7d`);
  return `https://news.google.com/rss/search?q=${q}&hl=nl&gl=BE&ceid=BE:nl`;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseGoogleNewsRss(xml: string): NewsItem[] {
  // A consent wall or error page answers 200 with HTML: that is a failure, not "no news".
  let doc: { rss?: { channel?: { item?: RssItem[] } | string } };
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('Not an RSS document');
  }
  if (!doc?.rss) throw new Error('Not an RSS document');
  const channel = typeof doc.rss.channel === 'object' ? doc.rss.channel : undefined;

  const items: NewsItem[] = [];
  for (const it of channel?.item ?? []) {
    if (!it.guid || !it.title || !it.link || !it.pubDate) continue;
    // The UI hands links to the OS browser: anything but http(s) (file:, ms-msdt:, …) is dropped.
    if (!HTTP_URL.test(it.link)) continue;
    const published = new Date(it.pubDate);
    if (isNaN(published.getTime())) continue;
    const publisher = it.source?.trim() || null;
    const suffix = publisher ? ` - ${publisher}` : null;
    const title = suffix && it.title.endsWith(suffix) ? it.title.slice(0, -suffix.length) : it.title;
    items.push({
      id: it.guid,
      title: title.trim(),
      publisher,
      url: it.link,
      published_at: published.toISOString(),
      source: 'google',
    });
  }

  // Collapse identical titles to the earliest copy, then keep the newest MAX_ITEMS.
  items.sort((a, b) => a.published_at.localeCompare(b.published_at));
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.reverse().slice(0, MAX_ITEMS);
}

export async function fetchKeywordNews(keyword: string): Promise<NewsItem[]> {
  const res = await fetch(googleNewsUrl(keyword), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google News answered ${res.status}`);
  return parseGoogleNewsRss(await res.text());
}
