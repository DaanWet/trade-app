import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKeywordNews, googleNewsUrl, parseGoogleNewsRss } from "./googleNews";

// Trimmed from a real response (2026-10-15). The <description> HTML and attributes are kept
// on purpose: the parser must ignore them.
function rss(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><generator>NFE/5.0</generator><title>"x" - Google Nieuws</title>${items}</channel></rss>`;
}

function rssItem(guid: string, title: string, pubDate: string, source: string): string {
  return `<item><title>${title}</title><link>https://news.google.com/rss/articles/${guid}?oc=5</link><guid isPermaLink="false">${guid}</guid><pubDate>${pubDate}</pubDate><description>&lt;a href="https://news.google.com/rss/articles/${guid}?oc=5" target="_blank"&gt;x&lt;/a&gt;</description><source url="https://example.be">${source}</source></item>`;
}

const FEED = rss(
  rssItem("AAA", "‘Het surrealisme van de meerwaardebelasting’ - Trends.be", "Tue, 13 Oct 2026 05:04:00 GMT", "Trends.be") +
    rssItem("BBB", "AT&amp;T verhoogt dividend - De Tijd", "Wed, 14 Oct 2026 08:19:28 GMT", "De Tijd") +
    rssItem("CCC", "AT&amp;T verhoogt  Dividend - De Tijd", "Thu, 15 Oct 2026 09:00:00 GMT", "De Tijd") +
    rssItem("DDD", "2026 - Belga", "Thu, 15 Oct 2026 12:18:21 GMT", "Belga"),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("googleNewsUrl", () => {
  it("searches the Belgian Dutch edition for the last 7 days", () => {
    const url = new URL(googleNewsUrl("ECB rente"));
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(url.searchParams.get("q")).toBe("ECB rente when:7d");
    expect(url.searchParams.get("hl")).toBe("nl");
    expect(url.searchParams.get("gl")).toBe("BE");
    expect(url.searchParams.get("ceid")).toBe("BE:nl");
  });
});

describe("parseGoogleNewsRss", () => {
  it("maps items, strips the ' - source' suffix and returns newest first", () => {
    const items = parseGoogleNewsRss(FEED);

    expect(items.map((i) => i.id)).toEqual(["DDD", "BBB", "AAA"]);
    expect(items[2]).toEqual({
      id: "AAA",
      title: "‘Het surrealisme van de meerwaardebelasting’",
      publisher: "Trends.be",
      url: "https://news.google.com/rss/articles/AAA?oc=5",
      published_at: "2026-10-13T05:04:00.000Z",
      source: "google",
    });
  });

  it("decodes entities and keeps numeric titles as text", () => {
    const items = parseGoogleNewsRss(FEED);
    expect(items.find((i) => i.id === "BBB")?.title).toBe("AT&T verhoogt dividend");
    expect(items.find((i) => i.id === "DDD")?.title).toBe("2026");
  });

  it("collapses identical titles (case and spacing aside) to the earliest", () => {
    const ids = parseGoogleNewsRss(FEED).map((i) => i.id);
    expect(ids).toContain("BBB");
    expect(ids).not.toContain("CCC");
  });

  it("handles a feed with a single item", () => {
    const items = parseGoogleNewsRss(rss(rssItem("ONE", "Eén - Bron", "Tue, 13 Oct 2026 05:04:00 GMT", "Bron")));
    expect(items.map((i) => i.id)).toEqual(["ONE"]);
  });

  it("drops items whose link is not http(s) (the UI hands links to the OS browser)", () => {
    const evil = (guid: string, link: string) =>
      rssItem(guid, `Artikel ${guid} - Bron`, "Tue, 13 Oct 2026 05:04:00 GMT", "Bron").replace(
        /<link>.*?<\/link>/,
        `<link>${link}</link>`,
      );
    const xml = rss(
      evil("OK1", "https://example.com/a") +
        evil("OK2", "HTTP://example.com/b") +
        evil("BAD1", "file:///etc/passwd") +
        evil("BAD2", "ms-msdt:/id PCWDiagnostic") +
        evil("BAD3", "javascript:alert(1)"),
    );

    expect(parseGoogleNewsRss(xml).map((i) => i.id).sort()).toEqual(["OK1", "OK2"]);
  });

  it("returns nothing for an empty channel", () => {
    expect(parseGoogleNewsRss(rss(""))).toEqual([]);
  });

  it("keeps at most the 20 newest items", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      rssItem(`G${i}`, `Artikel ${i} - Bron`, new Date(Date.UTC(2026, 9, 1 + i)).toUTCString(), "Bron"),
    ).join("");
    const items = parseGoogleNewsRss(rss(many));
    expect(items).toHaveLength(20);
    expect(items[0].id).toBe("G24");
  });

  it("throws on a page that is not RSS (e.g. a consent wall)", () => {
    expect(() => parseGoogleNewsRss("<!doctype html><html><body>Before you continue</body></html>")).toThrow(
      "Not an RSS document",
    );
  });
});

describe("fetchKeywordNews", () => {
  it("fetches and parses the feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(FEED, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    const items = await fetchKeywordNews("ECB rente");

    expect(timeout).toHaveBeenCalledWith(15_000);
    // A stalled request must not block the sequential refresh round for undici's 300 s default.
    expect(fetchMock).toHaveBeenCalledWith(googleNewsUrl("ECB rente"), {
      signal: expect.any(AbortSignal),
    });
    expect(items).toHaveLength(3);
  });

  it("throws on a non-2xx answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    await expect(fetchKeywordNews("ECB rente")).rejects.toThrow("Google News answered 503");
  });
});
