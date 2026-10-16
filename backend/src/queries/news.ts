import { db } from '../db';
import type { NewsTopicKind } from '../helpers/constants';
import type { NewsItem } from '../services/providers/types';

/** A followed subject as stored on article links: a ticker symbol or a keyword. */
export interface TopicRef {
  kind: NewsTopicKind;
  value: string;
}

export interface NewsTopicRow extends TopicRef {
  id: number;
  created_at: string;
}

export interface NewsArticleRow extends NewsItem {
  fetched_at: string;
}

export interface NewsArticleWithTopics extends NewsArticleRow {
  topics: TopicRef[];
}

export function topicKey(t: TopicRef): string {
  return `${t.kind}:${t.value}`;
}

export function listNewsTopics(): NewsTopicRow[] {
  return db.prepare(`SELECT * FROM news_topics ORDER BY id`).all() as NewsTopicRow[];
}

export function getNewsTopic(id: number): NewsTopicRow | null {
  return (db.prepare(`SELECT * FROM news_topics WHERE id = ?`).get(id) as NewsTopicRow | undefined) ?? null;
}

/** Case-insensitive on value (the column is COLLATE NOCASE). */
export function findNewsTopic(t: TopicRef): NewsTopicRow | null {
  return (
    (db.prepare(`SELECT * FROM news_topics WHERE kind = ? AND value = ?`).get(t.kind, t.value) as
      | NewsTopicRow
      | undefined) ?? null
  );
}

export function insertNewsTopic(t: TopicRef): NewsTopicRow {
  const info = db.prepare(`INSERT INTO news_topics (kind, value) VALUES (?, ?)`).run(t.kind, t.value);
  return getNewsTopic(Number(info.lastInsertRowid))!;
}

export function deleteNewsTopic(id: number): boolean {
  return db.prepare(`DELETE FROM news_topics WHERE id = ?`).run(id).changes > 0;
}

/**
 * Store one topic's articles. An article keeps its first fetched_at (that is what "new"
 * is measured against) and gets this topic's badge at most once.
 */
export function saveArticles(topic: TopicRef, items: NewsItem[], fetchedAt: string): void {
  const insertArticle = db.prepare(`
    INSERT OR IGNORE INTO news_articles (id, title, publisher, url, published_at, source, fetched_at)
    VALUES (@id, @title, @publisher, @url, @published_at, @source, @fetched_at)
  `);
  const insertLink = db.prepare(
    `INSERT OR IGNORE INTO news_article_topics (article_id, kind, value) VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    for (const item of items) {
      insertArticle.run({ ...item, fetched_at: fetchedAt });
      insertLink.run(item.id, topic.kind, topic.value);
    }
  })();
}

/** Delete articles published before the cutoff; their links go with them (ON DELETE CASCADE). */
export function pruneArticles(olderThan: string): number {
  return db.prepare(`DELETE FROM news_articles WHERE published_at < ?`).run(olderThan).changes;
}

// Matches a link against a JSON array of topicKey()s. kind never contains ':', so the key is unambiguous.
const FOLLOWED = `t.kind || ':' || t.value IN (SELECT value FROM json_each(?))`;

/** Articles linked to at least one of `topics`, newest first, with only those topics as badges. */
export function listArticlesFor(topics: TopicRef[]): NewsArticleWithTopics[] {
  const rows = db
    .prepare(`
      SELECT a.*, t.kind AS topic_kind, t.value AS topic_value
      FROM news_articles a
      JOIN news_article_topics t ON t.article_id = a.id
      WHERE ${FOLLOWED}
      ORDER BY a.published_at DESC, a.id, t.kind, t.value
    `)
    .all(JSON.stringify(topics.map(topicKey))) as (NewsArticleRow & {
    topic_kind: NewsTopicKind;
    topic_value: string;
  })[];

  const byId = new Map<string, NewsArticleWithTopics>();
  for (const { topic_kind, topic_value, ...article } of rows) {
    let entry = byId.get(article.id);
    if (!entry) {
      entry = { ...article, topics: [] };
      byId.set(article.id, entry);
    }
    entry.topics.push({ kind: topic_kind, value: topic_value });
  }
  return [...byId.values()];
}

/** Distinct articles about `topics` first fetched after `since` — the navbar badge. */
export function countFetchedAfter(topics: TopicRef[], since: string): number {
  const row = db
    .prepare(`
      SELECT COUNT(DISTINCT a.id) AS n
      FROM news_articles a
      JOIN news_article_topics t ON t.article_id = a.id
      WHERE a.fetched_at > ? AND ${FOLLOWED}
    `)
    .get(since, JSON.stringify(topics.map(topicKey))) as { n: number };
  return row.n;
}
