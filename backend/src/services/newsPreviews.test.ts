import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPreview, resolveGoogleNewsUrl } = vi.hoisted(() => ({
  fetchPreview: vi.fn(),
  resolveGoogleNewsUrl: vi.fn(),
}));
vi.mock("./articlePreview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./articlePreview")>()),
  fetchPreview,
}));
vi.mock("./providers/googleNews", () => ({ resolveGoogleNewsUrl }));

import { db } from "../db";
import { logger } from "../helpers/logger";
import { listArticlesFor, saveArticles, type TopicRef } from "../queries/news";
import type { NewsItem } from "./providers/types";
import { _resetProviderHealth, getProviderFailures } from "./providerHealth";
import { enrichPending } from "./newsPreviews";

const NVDA: TopicRef = { kind: "TICKER", value: "NVDA" };
const ECB: TopicRef = { kind: "KEYWORD", value: "ECB rente" };
const T = "2026-10-15T10:00:00.000Z";
const AT = "2026-10-15T12:00:00.000Z";
const OPTS = { since: "2026-09-15T00:00:00.000Z", limit: 50, at: AT };

function yahoo(id: string, published_at = "2026-10-15T08:00:00.000Z", image_url: string | null = null): NewsItem {
  return { id, title: `Title ${id}`, publisher: "Pub", url: `https://finance.yahoo.com/news/${id}.html`, published_at, source: "yahoo", image_url };
}

function google(id: string): NewsItem {
  return { id, title: `Titel ${id}`, publisher: "De Tijd", url: `https://news.google.com/rss/articles/${id}?oc=5`, published_at: "2026-10-15T08:00:00.000Z", source: "google", image_url: null };
}

function row(id: string) {
  return listArticlesFor([NVDA, ECB]).find((a) => a.id === id)!;
}

const OK = { kind: "ok", image_url: "https://img.example/og.jpg", summary: "Intro" } as const;

beforeEach(() => {
  db.exec("DELETE FROM news_article_topics; DELETE FROM news_articles;");
  vi.restoreAllMocks();
  fetchPreview.mockReset().mockResolvedValue(OK);
  resolveGoogleNewsUrl.mockReset();
  _resetProviderHealth();
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation(() => {});
  }
});

describe("enrichPending", () => {
  it("settles an ok preview with its image and intro", async () => {
    saveArticles(NVDA, [yahoo("a")], T);

    await enrichPending(OPTS);

    expect(fetchPreview).toHaveBeenCalledWith("https://finance.yahoo.com/news/a.html", "Title a");
    expect(row("a")).toMatchObject({ image_url: "https://img.example/og.jpg", summary: "Intro", preview_at: AT });
  });

  it("keeps the Yahoo search thumbnail over the page image", async () => {
    saveArticles(NVDA, [yahoo("a", undefined, "https://s.yimg.com/140.jpg")], T);

    await enrichPending(OPTS);

    expect(row("a").image_url).toBe("https://s.yimg.com/140.jpg");
  });

  it("settles a none and leaves a retry pending for the next call", async () => {
    saveArticles(NVDA, [yahoo("a"), yahoo("b")], T);
    fetchPreview.mockImplementation(async (url: string) =>
      url.includes("/a.") ? { kind: "none", reason: "403" } : { kind: "retry", reason: "503" },
    );

    await enrichPending(OPTS);

    expect(row("a")).toMatchObject({ image_url: null, summary: null, preview_at: AT });
    expect(row("b").preview_at).toBeNull();
    fetchPreview.mockClear();
    await enrichPending(OPTS);
    expect(fetchPreview.mock.calls.map((c) => c[0])).toEqual(["https://finance.yahoo.com/news/b.html"]);
  });

  it("decodes a Google link, stores the publisher url and reads that page", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockResolvedValue("https://www.tijd.be/x.html");

    await enrichPending(OPTS);

    expect(resolveGoogleNewsUrl).toHaveBeenCalledWith("g");
    expect(fetchPreview).toHaveBeenCalledWith("https://www.tijd.be/x.html", "Titel g");
    expect(row("g")).toMatchObject({ url: "https://www.tijd.be/x.html", summary: "Intro", preview_at: AT });
  });

  it("does not decode a Google article whose url was already decoded", async () => {
    saveArticles(ECB, [{ ...google("g"), url: "https://www.tijd.be/x.html" }], T);

    await enrichPending(OPTS);

    expect(resolveGoogleNewsUrl).not.toHaveBeenCalled();
    expect(fetchPreview).toHaveBeenCalledWith("https://www.tijd.be/x.html", "Titel g");
    expect(row("g")).toMatchObject({ preview_at: AT, summary: "Intro" });
  });

  it("keeps the decoded url even when the publisher refuses", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockResolvedValue("https://www.nieuwsblad.be/x");
    fetchPreview.mockResolvedValue({ kind: "none", reason: "403" });

    await enrichPending(OPTS);

    expect(row("g")).toMatchObject({ url: "https://www.nieuwsblad.be/x", summary: null, preview_at: AT });
  });

  it("refuses a decoded url pointing inward", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockResolvedValue("http://127.0.0.1:3100/api/diagnostics");

    await enrichPending(OPTS);

    expect(fetchPreview).not.toHaveBeenCalled();
    expect(row("g")).toMatchObject({ url: "https://news.google.com/rss/articles/g?oc=5", preview_at: AT });
  });

  it("treats a decoded url on a Google host as a failed decode", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockResolvedValue("https://consent.google.com/ml?continue=x");

    await enrichPending(OPTS);

    expect(fetchPreview).not.toHaveBeenCalled();
    expect(row("g")).toMatchObject({ url: "https://news.google.com/rss/articles/g?oc=5", preview_at: null });
    expect(getProviderFailures()["google.decode"]).toBe(1);
  });

  it("leaves a failed decode pending and counts it toward google/decode", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockRejectedValue(new Error("no decode signature on the article page"));

    await enrichPending(OPTS);

    expect(row("g").preview_at).toBeNull();
    expect(getProviderFailures()["google.decode"]).toBe(1);
  });

  it("names the network cause of a failed decode in the log line", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }));

    await enrichPending(OPTS);

    const lines = vi.mocked(logger.debug).mock.calls.map((c) => c[1]);
    expect(lines).toContain("preview: google decode failed (fetch failed (ECONNRESET))");
  });

  it("stops decoding after three failures in a row", async () => {
    saveArticles(ECB, ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"].map(google), T);
    resolveGoogleNewsUrl.mockRejectedValue(new Error("batchexecute answered 400"));

    await enrichPending(OPTS);

    expect(resolveGoogleNewsUrl.mock.calls.length).toBeLessThan(8);
    expect(listArticlesFor([ECB]).every((a) => a.preview_at === null)).toBe(true);
  });

  it("takes the newest articles first, up to the limit", async () => {
    saveArticles(NVDA, [yahoo("old", "2026-10-01T08:00:00.000Z"), yahoo("mid", "2026-10-10T08:00:00.000Z"), yahoo("new", "2026-10-15T08:00:00.000Z")], T);

    await enrichPending({ ...OPTS, limit: 2 });

    expect(fetchPreview.mock.calls.map((c) => c[1]).sort()).toEqual(["Title mid", "Title new"]);
    expect(row("old").preview_at).toBeNull();
  });

  it("can be restricted to one topic", async () => {
    saveArticles(NVDA, [yahoo("a")], T);
    saveArticles(ECB, [google("g")], T);

    await enrichPending({ ...OPTS, topic: NVDA });

    expect(resolveGoogleNewsUrl).not.toHaveBeenCalled();
    expect(row("g").preview_at).toBeNull();
  });

  it("tracks yahoo/article health: no intro is a failure, an intro a success", async () => {
    saveArticles(NVDA, [yahoo("a")], T);
    fetchPreview.mockResolvedValueOnce({ kind: "ok", image_url: null, summary: null });
    await enrichPending(OPTS);
    expect(getProviderFailures()["yahoo.article"]).toBe(1);

    saveArticles(NVDA, [yahoo("b")], T);
    await enrichPending(OPTS);
    expect(getProviderFailures()["yahoo.article"]).toBeUndefined();
  });

  it("does not count publisher pages toward provider health", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockResolvedValue("https://www.nieuwsblad.be/x");
    fetchPreview.mockResolvedValue({ kind: "none", reason: "403" });

    await enrichPending(OPTS);

    expect(Object.keys(getProviderFailures())).toEqual([]);
  });

  it("survives an unexpected throw and leaves the article pending", async () => {
    saveArticles(NVDA, [yahoo("a")], T);
    fetchPreview.mockRejectedValue(new Error("boom"));

    await expect(enrichPending(OPTS)).resolves.toBeUndefined();
    expect(row("a").preview_at).toBeNull();
  });

  it("names the network cause of an unexpected throw in the log line", async () => {
    saveArticles(NVDA, [yahoo("a")], T);
    fetchPreview.mockRejectedValue(new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } }));

    await enrichPending(OPTS);

    const lines = vi.mocked(logger.debug).mock.calls.map((c) => c[1]);
    expect(lines).toContain("preview failed: fetch failed (UND_ERR_SOCKET)");
  });

  it("logs hosts and counts, never an article's url or title", async () => {
    saveArticles(ECB, [google("g")], T);
    resolveGoogleNewsUrl.mockResolvedValue("https://www.tijd.be/geheim-keyword-artikel.html");
    fetchPreview.mockResolvedValue({ kind: "none", reason: "403" });

    await enrichPending(OPTS);

    const lines = [...vi.mocked(logger.debug).mock.calls, ...vi.mocked(logger.info).mock.calls].map((c) => c[1]);
    expect(lines).toContain("preview: www.tijd.be → 403");
    expect(lines).toContain("previews: 0 ok, 1 none, 0 retry");
    expect(lines.join("\n")).not.toMatch(/geheim|Titel g/);
  });

  it("does nothing when nothing is pending", async () => {
    await enrichPending(OPTS);
    expect(fetchPreview).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
