import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchTickerNews, fetchKeywordNews, enrichPending } = vi.hoisted(() => ({
  fetchTickerNews: vi.fn(),
  fetchKeywordNews: vi.fn(),
  enrichPending: vi.fn(),
}));
vi.mock("./providers/yahooNews", () => ({ fetchTickerNews }));
vi.mock("./providers/googleNews", () => ({ fetchKeywordNews }));
vi.mock("./newsPreviews", () => ({ enrichPending }));

import { db } from "../db";
import { logger } from "../helpers/logger";
import { insertTrade } from "../queries/trades";
import { upsertTicker } from "../queries/prices";
import * as newsQueries from "../queries/news";
import { insertNewsTopic, listArticlesFor, saveArticles } from "../queries/news";
import type { NewsItem } from "./providers/types";
import { _resetProviderHealth, ESCALATE_AFTER, getProviderFailures } from "./providerHealth";
import {
  _resetNewsService,
  _setNewsClock,
  followedTopics,
  getStatus,
  maybeRefresh,
  refreshNews,
  refreshTopic,
} from "./newsService";

const MIN = 60 * 1000;
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
let clock = NOW;

function item(id: string, published_at = "2026-10-15T08:00:00.000Z"): NewsItem {
  return { id, title: `Title ${id}`, publisher: "Pub", url: `https://example.com/${id}`, published_at, source: "yahoo", image_url: null };
}

function trade(ticker: string, side: "BUY" | "SELL", trade_date: string) {
  insertTrade({ ticker, trade_date, side, shares: 10, price: 100, currency: "USD" });
}

beforeEach(() => {
  db.exec(
    "DELETE FROM trades; DELETE FROM tickers; DELETE FROM news_article_topics; DELETE FROM news_articles; DELETE FROM news_topics;",
  );
  vi.restoreAllMocks();
  fetchTickerNews.mockReset().mockResolvedValue([]);
  fetchKeywordNews.mockReset().mockResolvedValue([]);
  enrichPending.mockReset().mockResolvedValue(undefined);
  _resetNewsService();
  _resetProviderHealth();
  clock = NOW;
  _setNewsClock(() => clock);
});

describe("followedTopics", () => {
  it("follows open positions, watchlist tickers and keywords", () => {
    trade("NVDA", "BUY", "2026-01-02");
    const amd = insertNewsTopic({ kind: "TICKER", value: "AMD" });
    const ecb = insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });

    expect(followedTopics()).toEqual([
      { id: null, kind: "TICKER", value: "NVDA", origin: "POSITION" },
      { id: amd.id, kind: "TICKER", value: "AMD", origin: "WATCHLIST" },
      { id: ecb.id, kind: "KEYWORD", value: "ECB rente", origin: "KEYWORD" },
    ]);
  });

  it("drops a position once it is sold out", () => {
    trade("NVDA", "BUY", "2026-01-02");
    trade("NVDA", "SELL", "2026-02-02");

    expect(followedTopics()).toEqual([]);
  });

  it("keeps a partially sold position and drops only the fully sold one", () => {
    trade("NVDA", "BUY", "2026-01-02");
    insertTrade({ ticker: "NVDA", trade_date: "2026-02-02", side: "SELL", shares: 4, price: 110, currency: "USD" });
    trade("AMD", "BUY", "2026-01-02");
    trade("AMD", "SELL", "2026-02-02");

    expect(followedTopics().map((t) => t.value)).toEqual(["NVDA"]);
  });

  it("lists a held watchlist ticker once, as a position that keeps its watchlist id", () => {
    trade("NVDA", "BUY", "2026-01-02");
    const w = insertNewsTopic({ kind: "TICKER", value: "NVDA" });

    expect(followedTopics()).toEqual([{ id: w.id, kind: "TICKER", value: "NVDA", origin: "POSITION" }]);
  });
});

describe("refreshNews", () => {
  it("stores articles with their badges and passes the cached company name", async () => {
    trade("KBC.BR", "BUY", "2026-01-02");
    upsertTicker({
      symbol: "KBC.BR",
      name: "KBC Group NV",
      currency: "EUR",
      last_price: null,
      last_price_at: null,
      previous_close: null,
      exchange: null,
      quote_type: null,
    });
    fetchTickerNews.mockResolvedValue([item("k1")]);

    await refreshNews();

    expect(fetchTickerNews).toHaveBeenCalledWith("KBC.BR", "KBC Group NV");
    expect(listArticlesFor(followedTopics()).map((a) => [a.id, a.topics])).toEqual([
      ["k1", [{ kind: "TICKER", value: "KBC.BR" }]],
    ]);
  });

  it("adds nothing on a second round and keeps the first fetched_at", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    await refreshNews();
    clock = NOW + 40 * MIN;
    await refreshNews();

    const [a] = listArticlesFor(followedTopics());
    expect(a.fetched_at).toBe(new Date(NOW).toISOString());
    expect(a.topics).toHaveLength(1);
  });

  it("keeps going when one topic fails and reports it in the status", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    trade("NVDA", "BUY", "2026-01-02");
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchTickerNews.mockRejectedValue(new Error("Too Many Requests"));
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    await refreshNews();

    expect(listArticlesFor(followedTopics()).map((a) => a.id)).toEqual(["g1"]);
    expect(getStatus()).toEqual({
      last_refresh_at: new Date(NOW).toISOString(),
      refreshing: false,
      failed_topics: [{ kind: "TICKER", value: "NVDA" }],
    });
  });

  it("never logs a keyword's text, not even when its failures escalate to an error", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    const topic = insertNewsTopic({ kind: "KEYWORD", value: "meerwaardebelasting" });
    fetchKeywordNews.mockRejectedValue(new Error("Google News answered 503"));

    for (let round = 0; round < ESCALATE_AFTER; round++) await refreshNews();

    // The streak did escalate (→ logger.error → Sentry), so the error spy saw the message too.
    expect(error).toHaveBeenCalledTimes(1);
    const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(`keyword #${topic.id}`);
    expect(logged).not.toContain("meerwaardebelasting");
  });

  it("runs one round for concurrent callers", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    let release!: (items: NewsItem[]) => void;
    fetchKeywordNews.mockReturnValueOnce(new Promise<NewsItem[]>((r) => (release = r)));

    const first = refreshNews();
    const second = refreshNews();
    expect(second).toBe(first);
    expect(getStatus().refreshing).toBe(true);

    release([]);
    await first;
    expect(fetchKeywordNews).toHaveBeenCalledTimes(1);
    expect(getStatus().refreshing).toBe(false);
  });

  it("does not count a fetch as a success when storing its articles fails", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockRejectedValueOnce(new Error("offline"));
    await refreshNews();
    expect(getProviderFailures()["google.news"]).toBe(1);

    // The fetch works, but the DB write faults: the streak must keep growing, not reset.
    fetchKeywordNews.mockResolvedValue([item("g1")]);
    vi.spyOn(newsQueries, "saveArticles").mockImplementation(() => {
      throw new Error("database is locked");
    });
    await refreshNews();

    expect(getProviderFailures()["google.news"]).toBe(2);
  });

  it("stops querying Yahoo for the other tickers after a rate limit, but still fetches keywords", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    trade("AMD", "BUY", "2026-01-02");
    trade("NVDA", "BUY", "2026-01-02");
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchTickerNews.mockRejectedValue(new Error("Too Many Requests"));
    fetchKeywordNews.mockResolvedValue([item("g1")]);

    await refreshNews();

    expect(fetchTickerNews).toHaveBeenCalledTimes(1);
    expect(fetchKeywordNews).toHaveBeenCalledTimes(1);
    expect(getStatus().failed_topics).toEqual([
      { kind: "TICKER", value: "AMD" },
      { kind: "TICKER", value: "NVDA" },
    ]);
  });

  it("keeps querying the other tickers after a failure that is not a rate limit", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    trade("AMD", "BUY", "2026-01-02");
    trade("NVDA", "BUY", "2026-01-02");
    fetchTickerNews.mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValueOnce([]);

    await refreshNews();

    expect(fetchTickerNews).toHaveBeenCalledTimes(2);
    expect(getStatus().failed_topics).toEqual([{ kind: "TICKER", value: "AMD" }]);
  });

  it("skips items past retention at ingest and prunes stored ones", async () => {
    trade("NVDA", "BUY", "2026-01-02");
    const nvda = { kind: "TICKER" as const, value: "NVDA" };
    saveArticles(nvda, [item("stored-old", "2026-09-01T00:00:00.000Z")], "2026-09-01T01:00:00.000Z");
    fetchTickerNews.mockResolvedValue([item("fresh"), item("fetched-old", "2026-08-01T00:00:00.000Z")]);

    await refreshNews();

    expect(listArticlesFor([nvda]).map((a) => a.id)).toEqual(["fresh"]);
    const links = db.prepare("SELECT COUNT(*) AS n FROM news_article_topics").get() as { n: number };
    expect(links.n).toBe(1);
  });
});

describe("maybeRefresh", () => {
  it("starts a round when nothing was fetched yet", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });

    maybeRefresh();

    expect(getStatus().refreshing).toBe(true);
    await refreshNews();
  });

  it("waits 30 minutes after a good round", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    await refreshNews();
    fetchKeywordNews.mockClear();

    clock = NOW + 29 * MIN;
    maybeRefresh();
    expect(getStatus().refreshing).toBe(false);

    clock = NOW + 31 * MIN;
    maybeRefresh();
    expect(getStatus().refreshing).toBe(true);
    await refreshNews();
    expect(fetchKeywordNews).toHaveBeenCalledTimes(1);
  });

  it("retries after 5 minutes when every topic failed", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockRejectedValue(new Error("offline"));
    await refreshNews();

    clock = NOW + 4 * MIN;
    maybeRefresh();
    expect(getStatus().refreshing).toBe(false);

    clock = NOW + 6 * MIN;
    maybeRefresh();
    expect(getStatus().refreshing).toBe(true);
    await refreshNews();
  });
});

describe("a round that throws", () => {
  it("still counts as a finished round, so the poll retries after 5 minutes instead of every 2", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    const prune = vi.spyOn(newsQueries, "pruneArticles").mockImplementation(() => {
      throw new Error("disk I/O error");
    });

    maybeRefresh();
    await vi.waitFor(() => expect(getStatus().refreshing).toBe(false));
    expect(error).toHaveBeenCalledTimes(1);
    expect(getStatus().last_refresh_at).toBe(new Date(NOW).toISOString());
    fetchKeywordNews.mockClear();

    clock = NOW + 2 * MIN; // the next badge poll
    maybeRefresh();
    expect(getStatus().refreshing).toBe(false);
    expect(fetchKeywordNews).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    clock = NOW + 6 * MIN;
    maybeRefresh();
    expect(getStatus().refreshing).toBe(true);
    await vi.waitFor(() => expect(getStatus().refreshing).toBe(false));
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it("rethrows to a caller that awaits the round", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    vi.spyOn(newsQueries, "pruneArticles").mockImplementation(() => {
      throw new Error("disk I/O error");
    });

    await expect(refreshNews()).rejects.toThrow("disk I/O error");
    expect(getStatus().refreshing).toBe(false);
  });
});

describe("refreshTopic", () => {
  it("fetches only that topic and updates just its failure state", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    trade("NVDA", "BUY", "2026-01-02");
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([item("g1")]);
    const topic = followedTopics().find((t) => t.kind === "KEYWORD")!;

    await refreshTopic(topic);
    expect(getStatus().failed_topics).toEqual([{ kind: "KEYWORD", value: "ECB rente" }]);

    await refreshTopic(topic);
    expect(getStatus().failed_topics).toEqual([]);
    expect(fetchTickerNews).not.toHaveBeenCalled();
    expect(listArticlesFor([topic]).map((a) => a.id)).toEqual(["g1"]);
  });
});

describe("previews", () => {
  const RETENTION_CUTOFF = new Date(NOW - 30 * 24 * 60 * MIN).toISOString();

  it("enriches after ingesting, within retention, before the round ends", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockResolvedValue([item("g1")]);
    let storedAtEnrich: string[] = [];
    enrichPending.mockImplementation(async () => {
      storedAtEnrich = listArticlesFor([{ kind: "KEYWORD", value: "ECB rente" }]).map((a) => a.id);
    });

    await refreshNews();

    expect(enrichPending).toHaveBeenCalledWith({ since: RETENTION_CUTOFF, limit: 50, at: new Date(NOW).toISOString() });
    expect(storedAtEnrich).toEqual(["g1"]);
  });

  it("stays refreshing until the previews are done", async () => {
    let finish!: () => void;
    enrichPending.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));

    const round = refreshNews();
    await vi.waitFor(() => expect(enrichPending).toHaveBeenCalled());
    expect(getStatus().refreshing).toBe(true);

    finish();
    await round;
    expect(getStatus().refreshing).toBe(false);
  });

  it("a failing preview step doesn't fail the round", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    enrichPending.mockRejectedValue(new Error("boom"));

    await expect(refreshNews()).resolves.toBeUndefined();

    expect(getStatus().last_refresh_at).not.toBeNull();
    expect(getStatus().failed_topics).toEqual([]);
    expect(warn).toHaveBeenCalledWith("news", expect.stringContaining("previews failed"));
  });

  it("a new follow enriches only that topic's articles", async () => {
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockResolvedValue([item("g1")]);
    const topic = followedTopics().find((t) => t.kind === "KEYWORD")!;

    await refreshTopic(topic);

    expect(enrichPending).toHaveBeenCalledWith({
      since: RETENTION_CUTOFF,
      limit: 20,
      topic: { kind: "KEYWORD", value: "ECB rente" },
      at: new Date(NOW).toISOString(),
    });
  });

  it("a follow whose fetch failed skips previews", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    insertNewsTopic({ kind: "KEYWORD", value: "ECB rente" });
    fetchKeywordNews.mockRejectedValue(new Error("offline"));
    const topic = followedTopics().find((t) => t.kind === "KEYWORD")!;

    await refreshTopic(topic);

    expect(enrichPending).not.toHaveBeenCalled();
  });
});
