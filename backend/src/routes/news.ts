import { Router } from 'express';
import { z } from 'zod';
import {
  followedTopics,
  getStatus,
  maybeRefresh,
  newsNowIso,
  refreshNews,
  refreshTopic,
} from '../services/newsService';
import {
  countFetchedAfter,
  deleteNewsTopic,
  findNewsTopic,
  insertNewsTopic,
  listArticlesFor,
  topicKey,
} from '../queries/news';
import { fetchQuote } from '../services/marketData';
import { getSetting, upsertSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';
import { errorMessage } from '../helpers/errors';
import { logger } from '../helpers/logger';

const router = Router();

const EPOCH = new Date(0).toISOString();

const topicSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TICKER'),
    value: z.string().trim().toUpperCase().regex(/^[A-Z0-9.^=\-]{1,20}$/, 'Ongeldig tickersymbool'),
  }),
  z.object({
    kind: z.literal('KEYWORD'),
    value: z.string().trim().min(2).max(60),
  }),
]);

const seenSchema = z.object({ seen_at: z.string().datetime() });

function lastSeen(): string {
  return getSetting(SETTING_KEYS.NEWS_LAST_SEEN) ?? EPOCH;
}

/**
 * The tab's payload. as_of is taken *before* reading, and the client echoes it back to
 * POST /seen: an article landing in between then stays "new" rather than being marked
 * seen without ever having been shown.
 */
function newsPayload() {
  const asOf = newsNowIso();
  const seen = lastSeen();
  const topics = followedTopics();
  // preview_at is enrichment bookkeeping, not part of the API.
  const articles = listArticlesFor(topics).map(({ fetched_at, preview_at, ...article }) => ({
    ...article,
    is_new: fetched_at > seen,
  }));
  // A failure outlives an unfollow / sell-out in memory; only report topics still followed.
  const followed = new Set(topics.map(topicKey));
  const status = getStatus();
  status.failed_topics = status.failed_topics.filter((t) => followed.has(topicKey(t)));
  return { articles, topics, status, as_of: asOf };
}

router.get('/', (_req, res) => {
  try {
    // Like the badge poll: a reload on /news after a long idle may reach the server before
    // /unread does, and the page would otherwise never join a round.
    maybeRefresh();
    res.json(newsPayload());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// The navbar polls this; it is also what keeps the background refresh going.
router.get('/unread', (_req, res) => {
  try {
    maybeRefresh();
    res.json({ count: countFetchedAfter(followedTopics(), lastSeen()), refreshing: getStatus().refreshing });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/seen', (req, res) => {
  const parsed = seenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid seen_at', issues: parsed.error.issues });
  }
  const seenAt = new Date(parsed.data.seen_at).toISOString();
  if (seenAt > newsNowIso()) return res.status(400).json({ error: 'seen_at ligt in de toekomst' });
  // Never move backwards: a late, older echo must not bring back "new" labels.
  if (seenAt > lastSeen()) upsertSetting(SETTING_KEYS.NEWS_LAST_SEEN, seenAt);
  res.status(204).end();
});

router.post('/refresh', async (_req, res) => {
  try {
    await refreshNews();
    res.json(newsPayload());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/topics', async (req, res) => {
  const parsed = topicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Ongeldig onderwerp', issues: parsed.error.issues });
  }
  try {
    if (findNewsTopic(parsed.data)) return res.status(409).json({ error: 'Dit onderwerp volg je al' });
    const row = insertNewsTopic(parsed.data);
    if (row.kind === 'TICKER') {
      // Fill the tickers cache first so the news search can also query by company name.
      await fetchQuote(row.value).catch((err) =>
        logger.warn('news', `quote warm-up for ${row.value} failed: ${errorMessage(err)}`),
      );
    }
    const topic = followedTopics().find((t) => topicKey(t) === topicKey(row))!;
    // A failed first fetch shows up in status.failed_topics; the topic is still followed.
    await refreshTopic(topic);
    res.status(201).json({ topic });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/topics/:id', (req, res) => {
  try {
    if (!deleteNewsTopic(parseInt(req.params.id, 10))) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
