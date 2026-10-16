import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { fetchTickerNews, fetchKeywordNews } = vi.hoisted(() => ({
  fetchTickerNews: vi.fn(),
  fetchKeywordNews: vi.fn(),
}));
vi.mock("../services/providers/yahooNews", () => ({ fetchTickerNews }));
vi.mock("../services/providers/googleNews", () => ({ fetchKeywordNews }));
vi.mock("../services/marketData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/marketData")>()),
  fetchQuote: vi.fn().mockResolvedValue(null),
}));

import { app } from "../app";
import { db } from "../db";
import { logger } from "../helpers/logger";
import { fetchQuote } from "../services/marketData";
import { insertNewsTopic } from "../queries/news";
import { _resetNewsService, getStatus } from "../services/newsService";
import type { NewsItem } from "../services/providers/types";

const RECENT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function item(id: string): NewsItem {
  return { id, title: `Title ${id}`, publisher: "Pub", url: `https://example.com/${id}`, published_at: RECENT, source: "google" };
}

function follow(kind: string, value: string) {
  return request(app).post("/api/news/topics").send({ kind, value });
}

beforeEach(() => {
  db.exec(
    "DELETE FROM trades; DELETE FROM news_article_topics; DELETE FROM news_articles; DELETE FROM news_topics; DELETE FROM settings WHERE key = 'news_last_seen';",
  );
  vi.restoreAllMocks();
  fetchTickerNews.mockReset().mockResolvedValue([]);
  fetchKeywordNews.mockReset().mockResolvedValue([]);
  vi.mocked(fetchQuote).mockClear();
  _resetNewsService();
});

// The badge poll starts rounds in the background; let them finish before the next test wipes the DB.
afterEach(async () => {
  await vi.waitFor(() => expect(getStatus().refreshing).toBe(false));
});

describe("news routes", () => {
  it("starts empty", async () => {
    const res = await request(app).get("/api/news");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ articles: [], topics: [], status: { failed_topics: [] } });
    expect(typeof res.body.as_of).toBe("string");
  });

  it("GET /api/news joins a background round too (a reload on /news must not wait for the badge poll)", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    const res = await request(app).get("/api/news");

    expect(res.body.status.refreshing).toBe(true);
    await vi.waitFor(() => expect(getStatus().refreshing).toBe(false));
    expect(fetchKeywordNews).toHaveBeenCalledTimes(1);
    const again = await request(app).get("/api/news");
    expect(again.body.articles.map((a: { id: string }) => a.id)).toEqual(["g1"]);
    expect(again.body.status.refreshing).toBe(false);
    expect(fetchKeywordNews).toHaveBeenCalledTimes(1); // fresh: no second round
  });

  it("follows a keyword, fetches it at once and lists its articles as new", async () => {
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    const res = await follow("KEYWORD", "  ECB rente ");

    expect(res.status).toBe(201);
    expect(res.body.topic).toMatchObject({ kind: "KEYWORD", value: "ECB rente", origin: "KEYWORD" });
    expect(fetchKeywordNews).toHaveBeenCalledWith("ECB rente");
    const list = await request(app).get("/api/news");
    expect(list.body.articles).toEqual([
      {
        id: "g1",
        title: "Title g1",
        publisher: "Pub",
        url: "https://example.com/g1",
        published_at: RECENT,
        source: "google",
        topics: [{ kind: "KEYWORD", value: "ECB rente" }],
        is_new: true,
      },
    ]);
  });

  it("uppercases a watchlist ticker and warms its quote before searching", async () => {
    const res = await follow("TICKER", "kbc.br");

    expect(res.status).toBe(201);
    expect(res.body.topic).toMatchObject({ kind: "TICKER", value: "KBC.BR", origin: "WATCHLIST" });
    expect(fetchQuote).toHaveBeenCalledWith("KBC.BR");
    expect(fetchTickerNews).toHaveBeenCalledWith("KBC.BR", null);
  });

  it.each([
    [{ kind: "TICKER", value: "KBC BR" }],
    [{ kind: "KEYWORD", value: "a" }],
    [{ kind: "KEYWORD", value: "x".repeat(61) }],
    [{ kind: "OTHER", value: "ECB" }],
  ])("rejects %j with 400", async (body) => {
    expect((await request(app).post("/api/news/topics").send(body)).status).toBe(400);
  });

  it("rejects the same keyword in another case with 409", async () => {
    expect((await follow("KEYWORD", "ECB rente")).status).toBe(201);
    expect((await follow("KEYWORD", " ecb RENTE")).status).toBe(409);
  });

  it("still adds the topic when its first fetch fails", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    fetchKeywordNews.mockRejectedValue(new Error("offline"));

    expect((await follow("KEYWORD", "ECB rente")).status).toBe(201);

    const list = await request(app).get("/api/news");
    expect(list.body.status.failed_topics).toEqual([{ kind: "KEYWORD", value: "ECB rente" }]);
  });

  it("forgets a failed topic once it is unfollowed", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    fetchKeywordNews.mockRejectedValue(new Error("offline"));
    const { body } = await follow("KEYWORD", "ECB rente");
    expect((await request(app).get("/api/news")).body.status.failed_topics).toEqual([
      { kind: "KEYWORD", value: "ECB rente" },
    ]);

    await request(app).delete(`/api/news/topics/${body.topic.id}`);

    expect((await request(app).get("/api/news")).body.status.failed_topics).toEqual([]);
  });

  it("unfollowing hides the topic and its articles; an unknown id gives 404", async () => {
    fetchKeywordNews.mockResolvedValue([item("g1")]);
    const { body } = await follow("KEYWORD", "ECB rente");

    expect((await request(app).delete(`/api/news/topics/${body.topic.id}`)).status).toBe(204);

    const list = await request(app).get("/api/news");
    expect(list.body.articles).toEqual([]);
    expect(list.body.topics).toEqual([]);
    expect((await request(app).delete(`/api/news/topics/${body.topic.id}`)).status).toBe(404);
  });

  it("marks articles seen as of the server's as_of", async () => {
    fetchKeywordNews.mockResolvedValue([item("g1")]);
    await follow("KEYWORD", "ECB rente");
    const first = await request(app).get("/api/news");

    expect((await request(app).post("/api/news/seen").send({ seen_at: first.body.as_of })).status).toBe(204);

    expect((await request(app).get("/api/news")).body.articles[0].is_new).toBe(false);
    expect((await request(app).get("/api/news/unread")).body.count).toBe(0);
  });

  it("never moves the seen marker backwards and rejects a future or malformed one", async () => {
    fetchKeywordNews.mockResolvedValue([item("g1")]);
    await follow("KEYWORD", "ECB rente");
    const { body } = await request(app).get("/api/news");
    await request(app).post("/api/news/seen").send({ seen_at: body.as_of });

    const stale = await request(app).post("/api/news/seen").send({ seen_at: "2020-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(204);
    expect((await request(app).get("/api/news")).body.articles[0].is_new).toBe(false);

    expect((await request(app).post("/api/news/seen").send({ seen_at: "2999-01-01T00:00:00.000Z" })).status).toBe(400);
    expect((await request(app).post("/api/news/seen").send({ seen_at: "gisteren" })).status).toBe(400);
  });

  it("the badge poll starts a background round and then counts what it found", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    await request(app).get("/api/news/unread");
    await vi.waitFor(() => expect(getStatus().refreshing).toBe(false));
    const res = await request(app).get("/api/news/unread");

    expect(res.body).toEqual({ count: 1, refreshing: false });
    expect(fetchKeywordNews).toHaveBeenCalledTimes(1);
  });

  it("POST /refresh waits for the round and returns the fresh list", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    const res = await request(app).post("/api/news/refresh");

    expect(res.status).toBe(200);
    expect(res.body.articles.map((a: { id: string }) => a.id)).toEqual(["g1"]);
    expect(res.body.status.last_refresh_at).not.toBeNull();
  });
});
