import { fetchPreview, hostOf, isAllowedUrl, type PreviewOutcome } from './articlePreview';
import { resolveGoogleNewsUrl } from './providers/googleNews';
import { recordFailure, recordSuccess } from './providerHealth';
import {
  listPendingPreviews,
  setArticleUrl,
  settlePreview,
  type PendingPreview,
  type TopicRef,
} from '../queries/news';
import { logger } from '../helpers/logger';
import { fetchErrorMessage } from '../helpers/errors';

/**
 * Article previews (issue #11 addendum): once per article, read the image + intro its page
 * publishes for social sharing. Runs after a round's ingest and never fails it.
 *
 * `ok` and `none` settle an article (preview_at set); `retry` leaves it pending, so a later
 * round tries again — bounded by retention. Google links first go through the unofficial
 * decode; three decode failures in a row skip the rest of Google for this call, so a broken
 * decode doesn't hammer Google every round.
 *
 * Logs carry hosts and counts only: an article's URL or title can reveal a keyword.
 */

const CONCURRENCY = 4;
const DECODE_BREAKER = 3;

export interface EnrichOptions {
  /** Retention cutoff: older articles are about to be pruned. */
  since: string;
  limit: number;
  /** Only this topic's articles (a fresh follow). */
  topic?: TopicRef;
  /** Stamped into preview_at. */
  at: string;
}

function onHost(url: string, domain: string): boolean {
  const host = hostOf(url);
  return host === domain || host.endsWith(`.${domain}`);
}

export async function enrichPending(opts: EnrichOptions): Promise<void> {
  const pending = listPendingPreviews(opts);
  if (pending.length === 0) return;

  const counts: Record<PreviewOutcome['kind'], number> = { ok: 0, none: 0, retry: 0 };
  let decodeFailures = 0;

  /** The publisher URL for a Google item, or null when the decode failed (stays pending). */
  async function decode(article: PendingPreview): Promise<string | null> {
    if (decodeFailures >= DECODE_BREAKER) return null;
    try {
      const url = await resolveGoogleNewsUrl(article.id);
      // A Google host here means the decode went wrong; its page describes Google News itself.
      if (onHost(url, 'google.com')) throw new Error('decoded to a Google page');
      decodeFailures = 0;
      recordSuccess('google', 'decode');
      return url;
    } catch (err) {
      decodeFailures++;
      const why = fetchErrorMessage(err);
      recordFailure('google', 'decode', why);
      logger.debug('news', `preview: google decode failed (${why})`);
      return null;
    }
  }

  async function enrichOne(article: PendingPreview): Promise<void> {
    let url = article.url;
    // A stored url that already left news.google.com was decoded by an earlier call whose
    // page fetch came back as a retry: read that page, don't decode again.
    if (article.source === 'google' && onHost(article.url, 'news.google.com')) {
      const decoded = await decode(article);
      if (decoded == null) {
        counts.retry++;
        return;
      }
      if (!isAllowedUrl(decoded)) {
        settlePreview(article.id, null, opts.at);
        logger.debug('news', 'preview: decoded url refused');
        counts.none++;
        return;
      }
      setArticleUrl(article.id, decoded);
      url = decoded;
    }

    const outcome = await fetchPreview(url, article.title);
    counts[outcome.kind]++;
    if (outcome.kind === 'ok') {
      const found = { image_url: outcome.image_url, summary: outcome.summary };
      settlePreview(article.id, found, opts.at);
    } else {
      if (outcome.kind === 'none') settlePreview(article.id, null, opts.at);
      logger.debug('news', `preview: ${hostOf(url) || '?'} → ${outcome.reason}`);
    }

    // Yahoo's own article pages always carry an intro; a run without one means a consent
    // wall or a layout change. Publisher pages vary per site and aren't tracked.
    if (article.source === 'yahoo' && onHost(url, 'yahoo.com')) {
      if (outcome.kind === 'ok' && outcome.summary) {
        recordSuccess('yahoo', 'article');
      } else {
        const why = outcome.kind === 'ok' ? 'page without intro' : outcome.reason;
        recordFailure('yahoo', 'article', why);
      }
    }
  }

  const queue = [...pending];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        await enrichOne(next);
      } catch (err) {
        counts.retry++;
        logger.debug('news', `preview failed: ${fetchErrorMessage(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  logger.info('news', `previews: ${counts.ok} ok, ${counts.none} none, ${counts.retry} retry`);
}
