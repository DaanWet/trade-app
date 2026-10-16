import type { NewsArticle, NewsTopicRef } from '../models';
import { chipCounts, filterArticles, topicKey } from './news-filter';

const NVDA: NewsTopicRef = { kind: 'TICKER', value: 'NVDA' };
const AMD: NewsTopicRef = { kind: 'TICKER', value: 'AMD' };
const ECB: NewsTopicRef = { kind: 'KEYWORD', value: 'ECB rente' };

function article(id: string, topics: NewsTopicRef[]): NewsArticle {
  return {
    id,
    title: id,
    publisher: null,
    url: `https://example.com/${id}`,
    published_at: '2026-10-15T08:00:00.000Z',
    source: 'yahoo',
    image_url: null,
    summary: null,
    topics,
    is_new: false,
  };
}

const ARTICLES = [article('a', [NVDA]), article('b', [NVDA, AMD]), article('c', [ECB])];

describe('news-filter', () => {
  it('toont alles zonder filter', () => {
    expect(filterArticles(ARTICLES, null)).toBe(ARTICLES);
  });

  it('filtert op één onderwerp, ook artikels met meerdere badges', () => {
    expect(filterArticles(ARTICLES, NVDA).map(a => a.id)).toEqual(['a', 'b']);
  });

  it('onderscheidt een ticker van een trefwoord met dezelfde tekst', () => {
    expect(filterArticles(ARTICLES, { kind: 'KEYWORD', value: 'NVDA' })).toEqual([]);
  });

  it('telt per chip, met 0 voor onderwerpen zonder artikels', () => {
    const hypg: NewsTopicRef = { kind: 'TICKER', value: 'HYPG' };
    const counts = chipCounts(ARTICLES, [NVDA, AMD, ECB, hypg]);
    expect([...counts.entries()]).toEqual([
      [topicKey(NVDA), 2],
      [topicKey(AMD), 1],
      [topicKey(ECB), 1],
      [topicKey(hypg), 0],
    ]);
  });
});
