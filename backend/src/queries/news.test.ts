import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { NewsItem } from "../services/providers/types";
import {
  countFetchedAfter,
  deleteNewsTopic,
  findNewsTopic,
  insertNewsTopic,
  listArticlesFor,
  listNewsTopics,
  pruneArticles,
  saveArticles,
  type TopicRef,
} from "./news";

const NVDA: TopicRef = { kind: "TICKER", value: "NVDA" };
const AMD: TopicRef = { kind: "TICKER", value: "AMD" };
const ECB: TopicRef = { kind: "KEYWORD", value: "ECB rente" };
const T = "2026-10-15T10:00:00.000Z";

function item(id: string, published_at = "2026-10-15T08:00:00.000Z"): NewsItem {
  return { id, title: `Title ${id}`, publisher: "Pub", url: `https://example.com/${id}`, published_at, source: "yahoo" };
}

function linkCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM news_article_topics").get() as { n: number }).n;
}

beforeEach(() => {
  db.exec("DELETE FROM news_article_topics; DELETE FROM news_articles; DELETE FROM news_topics;");
});

describe("news topics", () => {
  it("inserts, lists in creation order, finds and deletes", () => {
    const a = insertNewsTopic(NVDA);
    const b = insertNewsTopic(ECB);

    expect(listNewsTopics().map((t) => t.id)).toEqual([a.id, b.id]);
    expect(findNewsTopic(ECB)?.id).toBe(b.id);
    expect(deleteNewsTopic(a.id)).toBe(true);
    expect(deleteNewsTopic(a.id)).toBe(false);
    expect(listNewsTopics().map((t) => t.value)).toEqual(["ECB rente"]);
  });

  it("treats a keyword in another case as the same topic", () => {
    insertNewsTopic(ECB);

    expect(findNewsTopic({ kind: "KEYWORD", value: "ecb RENTE" })?.value).toBe("ECB rente");
    expect(() => insertNewsTopic({ kind: "KEYWORD", value: "ecb rente" })).toThrow();
  });
});

describe("saveArticles", () => {
  it("is idempotent and keeps the first fetched_at", () => {
    saveArticles(NVDA, [item("a")], T);
    saveArticles(NVDA, [item("a")], "2026-10-15T10:30:00.000Z");

    const [a] = listArticlesFor([NVDA]);
    expect(a.fetched_at).toBe(T);
    expect(a.topics).toEqual([NVDA]);
    expect(linkCount()).toBe(1);
  });

  it("gives one article a badge per topic", () => {
    saveArticles(NVDA, [item("a")], T);
    saveArticles(AMD, [item("a")], T);

    expect(listArticlesFor([NVDA, AMD])).toHaveLength(1);
    expect(listArticlesFor([NVDA, AMD])[0].topics).toEqual([AMD, NVDA]);
  });
});

describe("listArticlesFor", () => {
  it("returns only articles about the given topics, newest first, with only those badges", () => {
    saveArticles(NVDA, [item("old", "2026-10-14T08:00:00.000Z"), item("new")], T);
    saveArticles(AMD, [item("new"), item("amd-only")], T);

    const out = listArticlesFor([NVDA]);

    expect(out.map((a) => a.id)).toEqual(["new", "old"]);
    expect(out[0].topics).toEqual([NVDA]);
  });

  it("returns nothing when no topics are followed", () => {
    saveArticles(NVDA, [item("a")], T);
    expect(listArticlesFor([])).toEqual([]);
  });
});

describe("countFetchedAfter", () => {
  it("counts distinct articles fetched after the timestamp, for followed topics only", () => {
    saveArticles(NVDA, [item("a")], "2026-10-15T09:00:00.000Z");
    saveArticles(NVDA, [item("b")], "2026-10-15T11:00:00.000Z");
    saveArticles(AMD, [item("b"), item("c")], "2026-10-15T11:00:00.000Z");

    expect(countFetchedAfter([NVDA, AMD], "2026-10-15T10:00:00.000Z")).toBe(2);
    expect(countFetchedAfter([NVDA], "2026-10-15T10:00:00.000Z")).toBe(1);
    expect(countFetchedAfter([ECB], "1970-01-01T00:00:00.000Z")).toBe(0);
  });
});

describe("pruneArticles", () => {
  it("deletes articles published before the cutoff, and their links with them", () => {
    saveArticles(NVDA, [item("old", "2026-09-01T00:00:00.000Z"), item("fresh")], T);

    expect(pruneArticles("2026-09-15T00:00:00.000Z")).toBe(1);
    expect(listArticlesFor([NVDA]).map((a) => a.id)).toEqual(["fresh"]);
    expect(linkCount()).toBe(1);
  });
});
