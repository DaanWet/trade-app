import { fetchTickerNews } from './providers/yahooNews';
import { fetchKeywordNews } from './providers/googleNews';
import type { NewsItem } from './providers/types';
import { recordFailure, recordSuccess } from './providerHealth';
import { enrichPending, type EnrichOptions } from './newsPreviews';
import { openTickerSymbols } from '../queries/trades';
import { getTicker } from '../queries/prices';
import { listNewsTopics, pruneArticles, saveArticles, topicKey, type TopicRef } from '../queries/news';
import { logger } from '../helpers/logger';
import { errorMessage } from '../helpers/errors';
import { isRateLimitError } from './rateLimitMonitor';
import {
  NEWS_PREVIEWS_PER_FOLLOW,
  NEWS_PREVIEWS_PER_ROUND,
  NEWS_REFRESH_INTERVAL_MS,
  NEWS_RETENTION_DAYS,
  NEWS_RETRY_AFTER_FAILURE_MS,
} from '../helpers/constants';

/**
 * News feed orchestration (issue #11).
 *
 * Followed topics = open positions (derived, one grouped query) ∪ news_topics (watchlist + keywords). A round
 * fetches every topic sequentially, stores articles + badges, fetches previews for new articles
 * (newsPreviews.ts), then prunes past retention.
 * There is no timer: the navbar's badge poll calls maybeRefresh(), which starts a round in
 * the background when the last one is stale. The last-refresh time lives in memory only,
 * so every app start fetches straight away.
 */

export type NewsTopicOrigin = 'POSITION' | 'WATCHLIST' | 'KEYWORD';

export interface FollowedTopic extends TopicRef {
  /** news_topics.id; null for a position that isn't also on the watchlist. */
  id: number | null;
  origin: NewsTopicOrigin;
}

export interface NewsStatus {
  last_refresh_at: string | null;
  refreshing: boolean;
  failed_topics: TopicRef[];
}

let now: () => number = Date.now;
let inFlight: Promise<void> | null = null;
let lastRefreshAt: number | null = null;
let lastRoundAllFailed = false;
let failedTopics: TopicRef[] = [];

/** Test hook: drive the refresh thresholds without real time passing. */
export function _setNewsClock(fn: () => number): void {
  now = fn;
}

export function _resetNewsService(): void {
  now = Date.now;
  inFlight = null;
  lastRefreshAt = null;
  lastRoundAllFailed = false;
  failedTopics = [];
}

export function newsNowIso(): string {
  return new Date(now()).toISOString();
}

function retentionCutoff(): string {
  return new Date(now() - NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function followedTopics(): FollowedTopic[] {
  const out = new Map<string, FollowedTopic>();
  for (const symbol of openTickerSymbols()) {
    const topic: FollowedTopic = { id: null, kind: 'TICKER', value: symbol, origin: 'POSITION' };
    out.set(topicKey(topic), topic);
  }
  for (const row of listNewsTopics()) {
    const held = out.get(topicKey(row));
    if (held) {
      // Held and on the watchlist: shown as the position, but the watchlist row takes over
      // (and stays removable) once the position is sold.
      held.id = row.id;
      continue;
    }
    out.set(topicKey(row), {
      id: row.id,
      kind: row.kind,
      value: row.value,
      origin: row.kind === 'TICKER' ? 'WATCHLIST' : 'KEYWORD',
    });
  }
  return [...out.values()];
}

/** Log-safe name: a keyword reveals interests and must not leave the machine via Sentry. */
function topicLabel(topic: FollowedTopic): string {
  return topic.kind === 'TICKER' ? topic.value : `keyword #${topic.id ?? '?'}`;
}

function fetchTopic(topic: FollowedTopic): Promise<NewsItem[]> {
  if (topic.kind === 'TICKER') return fetchTickerNews(topic.value, getTicker(topic.value)?.name ?? null);
  return fetchKeywordNews(topic.value);
}

type IngestResult = 'ok' | 'failed' | 'rate_limited';

/** Fetch + store one topic. `rate_limited`: Yahoo answered 429, so the rest of the round should back off. */
async function ingestTopic(topic: FollowedTopic): Promise<IngestResult> {
  const provider = topic.kind === 'TICKER' ? 'yahoo' : 'google';
  try {
    const items = await fetchTopic(topic);
    // Skip stale items up front: inserting then pruning them would re-insert them as
    // "new" every round (Yahoo's name search returns months-old articles).
    const cutoff = retentionCutoff();
    saveArticles(topic, items.filter((i) => i.published_at >= cutoff), newsNowIso());
    // Only after the save: a DB fault must not read as success-then-failure and reset the streak.
    recordSuccess(provider, 'news');
    return 'ok';
  } catch (err) {
    const message = errorMessage(err);
    logger.warn('news', `fetch failed for ${topicLabel(topic)}: ${message}`);
    recordFailure(provider, 'news', message);
    return topic.kind === 'TICKER' && isRateLimitError(err) ? 'rate_limited' : 'failed';
  }
}

/** Previews are a bonus: nothing that goes wrong there may fail the round or the follow. */
async function enrichSafely(opts: Pick<EnrichOptions, 'limit' | 'topic'>): Promise<void> {
  try {
    await enrichPending({ ...opts, since: retentionCutoff(), at: newsNowIso() });
  } catch (err) {
    logger.warn('news', `previews failed: ${errorMessage(err)}`);
  }
}

async function runRefresh(): Promise<void> {
  let topics: FollowedTopic[] = [];
  const failed: TopicRef[] = [];
  let completed = false;
  try {
    topics = followedTopics();
    let yahooLimited = false;
    // Sequential on purpose: Yahoo rate-limits bursts.
    for (const topic of topics) {
      const ref = { kind: topic.kind, value: topic.value };
      if (yahooLimited && topic.kind === 'TICKER') {
        // Yahoo already said 429 this round: hammering on only prolongs it. No news was
        // fetched for these, so they show as failed; keywords (Google) are unaffected.
        failed.push(ref);
        continue;
      }
      const result = await ingestTopic(topic);
      if (result !== 'ok') failed.push(ref);
      if (result === 'rate_limited') {
        yahooLimited = true;
        logger.warn('news', 'Yahoo rate limit hit; skipping the remaining ticker topics this round');
      }
    }
    await enrichSafely({ limit: NEWS_PREVIEWS_PER_ROUND });
    pruneArticles(retentionCutoff());
    completed = true;
  } finally {
    // Also when the round threw (prune / DB error): without this lastRefreshAt would stay unset,
    // so every 2-minute badge poll would start a full round and log an error again.
    lastRefreshAt = now();
    failedTopics = failed;
    lastRoundAllFailed = !completed || (topics.length > 0 && failed.length === topics.length);
  }
}

/** One round at a time: a caller arriving mid-round gets the running round's promise. */
export function refreshNews(): Promise<void> {
  if (!inFlight) {
    inFlight = runRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Fetch a single topic right after it was followed, so the user sees results at once. */
export async function refreshTopic(topic: FollowedTopic): Promise<void> {
  const result = await ingestTopic(topic);
  failedTopics = failedTopics.filter((t) => topicKey(t) !== topicKey(topic));
  if (result !== 'ok') failedTopics.push({ kind: topic.kind, value: topic.value });
  if (result === 'ok') {
    await enrichSafely({ limit: NEWS_PREVIEWS_PER_FOLLOW, topic: { kind: topic.kind, value: topic.value } });
  }
}

/** Start a background round when the last one is stale. Never awaited by callers. */
export function maybeRefresh(): void {
  if (inFlight) return;
  if (lastRefreshAt != null) {
    const wait = lastRoundAllFailed ? NEWS_RETRY_AFTER_FAILURE_MS : NEWS_REFRESH_INTERVAL_MS;
    if (now() - lastRefreshAt < wait) return;
  }
  refreshNews().catch((err) => logger.error('news', `refresh failed: ${errorMessage(err)}`));
}

export function getStatus(): NewsStatus {
  return {
    last_refresh_at: lastRefreshAt != null ? new Date(lastRefreshAt).toISOString() : null,
    refreshing: inFlight != null,
    failed_topics: failedTopics,
  };
}
