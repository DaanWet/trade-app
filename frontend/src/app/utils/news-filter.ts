import type { NewsArticle, NewsTopicRef } from '../models';

/** Sleutel van een onderwerp; kind erbij zodat ticker "NVDA" ≠ trefwoord "NVDA". */
export function topicKey(t: NewsTopicRef): string {
  return `${t.kind}:${t.value}`;
}

/** Artikels voor één chip; `null` is "Alles". */
export function filterArticles(articles: NewsArticle[], topic: NewsTopicRef | null): NewsArticle[] {
  if (!topic) return articles;
  const key = topicKey(topic);
  return articles.filter(a => a.topics.some(t => topicKey(t) === key));
}

/** Aantal artikels per chip (sleutel = topicKey), in de volgorde van `topics`; 0 als er geen zijn. */
export function chipCounts(articles: NewsArticle[], topics: NewsTopicRef[]): Map<string, number> {
  const counts = new Map<string, number>(topics.map(t => [topicKey(t), 0]));
  for (const a of articles) {
    for (const t of a.topics) {
      const key = topicKey(t);
      const n = counts.get(key);
      if (n !== undefined) counts.set(key, n + 1);
    }
  }
  return counts;
}
