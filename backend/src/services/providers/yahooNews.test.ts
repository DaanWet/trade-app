import { beforeEach, describe, expect, it, vi } from "vitest";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("../yahooClient", () => ({ yahoo: { search } }));

import { cleanCompanyName, fetchTickerNews, pickThumbnail } from "./yahooNews";

function raw(uuid: string, relatedTickers: string[]) {
  return {
    uuid,
    title: `Title ${uuid}`,
    publisher: "MT Newswires",
    link: `https://finance.yahoo.com/news/${uuid}`,
    providerPublishTime: new Date("2026-10-15T15:08:46.000Z"),
    relatedTickers,
  };
}

// Block body on purpose: an arrow expression returns the spy, which vitest runs as a
// teardown after each test, leaking a rejected call into the "every query fails" case.
beforeEach(() => {
  search.mockReset();
});

describe("cleanCompanyName", () => {
  it.each([
    ["KBC Group NV", "KBC Group"],
    ["Advanced Micro Devices, Inc.", "Advanced Micro Devices"],
    ["KB Components AB (publ)", "KB Components"],
    ["NVIDIA Corporation", "NVIDIA"],
    ["ASML Holding N.V.", "ASML Holding"],
    ["Simplify China A Shares PLUS Income ETF", "Simplify China A Shares PLUS Income ETF"],
    ["SA", "SA"],
  ])("%s → %s", (input, expected) => {
    expect(cleanCompanyName(input)).toBe(expected);
  });
});

describe("fetchTickerNews", () => {
  it("keeps only items Yahoo tags with the symbol (short symbols match other companies)", async () => {
    search.mockResolvedValue({ news: [raw("a", ["CAS"]), raw("b", ["FNMA"]), raw("c", [])] });

    const items = await fetchTickerNews("CAS", null);

    expect(items.map((i) => i.id)).toEqual(["a"]);
  });

  it("only queries the symbol when no company name is known", async () => {
    search.mockResolvedValue({ news: [] });

    await fetchTickerNews("NG=F", null);

    expect(search.mock.calls.map((c) => c[0])).toEqual(["NG=F"]);
    expect(search.mock.calls[0][1]).toEqual({ quotesCount: 0, newsCount: 10 });
  });

  it("also queries the cleaned name, merging and deduping on uuid", async () => {
    search
      .mockResolvedValueOnce({ news: [] })
      .mockResolvedValueOnce({
        news: [raw("k1", ["KBC.BR"]), raw("k2", ["JEF", "kbc.br"]), raw("k1", ["KBC.BR"])],
      });

    const items = await fetchTickerNews("KBC.BR", "KBC Group NV");

    expect(search.mock.calls.map((c) => c[0])).toEqual(["KBC.BR", "KBC Group"]);
    expect(items.map((i) => i.id)).toEqual(["k1", "k2"]);
  });

  it("maps a Yahoo item to a NewsItem", async () => {
    search.mockResolvedValue({ news: [raw("a", ["ASML"])] });

    const [item] = await fetchTickerNews("asml", null);

    expect(item).toEqual({
      id: "a",
      title: "Title a",
      publisher: "MT Newswires",
      url: "https://finance.yahoo.com/news/a",
      published_at: "2026-10-15T15:08:46.000Z",
      source: "yahoo",
      image_url: null,
    });
  });

  it("drops items whose link is not http(s) (the UI hands links to the OS browser)", async () => {
    search.mockResolvedValue({
      news: [
        raw("ok", ["ASML"]),
        { ...raw("file", ["ASML"]), link: "file:///etc/passwd" },
        { ...raw("msdt", ["ASML"]), link: "ms-msdt:/id PCWDiagnostic" },
        { ...raw("js", ["ASML"]), link: "javascript:alert(1)" },
      ],
    });

    const items = await fetchTickerNews("ASML", null);

    expect(items.map((i) => i.id)).toEqual(["ok"]);
  });

  it("survives one failing query", async () => {
    search
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ news: [raw("k1", ["KBC.BR"])] });

    const items = await fetchTickerNews("KBC.BR", "KBC Group NV");

    expect(items.map((i) => i.id)).toEqual(["k1"]);
  });

  it("does not query the name once the symbol query was rate limited", async () => {
    search.mockRejectedValue(new Error("Too Many Requests"));

    await expect(fetchTickerNews("KBC.BR", "KBC Group NV")).rejects.toThrow("Too Many Requests");

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("keeps the symbol results when only the name query is rate limited", async () => {
    search
      .mockResolvedValueOnce({ news: [raw("k1", ["KBC.BR"])] })
      .mockRejectedValueOnce(new Error("Too Many Requests"));

    const items = await fetchTickerNews("KBC.BR", "KBC Group NV");

    expect(items.map((i) => i.id)).toEqual(["k1"]);
  });

  it("throws when every query fails", async () => {
    search.mockRejectedValue(new Error("fetch failed"));

    await expect(fetchTickerNews("KBC.BR", "KBC Group NV")).rejects.toThrow("fetch failed");
  });

  it("carries the search thumbnail", async () => {
    const withThumb = {
      ...raw("a", ["ASML"]),
      thumbnail: { resolutions: [{ url: "https://s.yimg.com/140.jpg", width: 140, height: 140, tag: "140x140" }] },
    };
    search.mockResolvedValue({ news: [withThumb] });

    const [item] = await fetchTickerNews("ASML", null);

    expect(item.image_url).toBe("https://s.yimg.com/140.jpg");
  });
});

describe("pickThumbnail", () => {
  const res = (url: string, width: number, tag: string) => ({ url, width, height: width, tag });

  it("prefers the ready-made 140x140 crop", () => {
    const thumb = { resolutions: [res("https://x/orig.jpg", 2560, "original"), res("https://x/140.jpg", 140, "140x140")] };
    expect(pickThumbnail(thumb)).toBe("https://x/140.jpg");
  });

  it("falls back to the smallest resolution at least 100 px wide", () => {
    const thumb = {
      resolutions: [res("https://x/big.jpg", 1200, "original"), res("https://x/tiny.jpg", 50, "50x50"), res("https://x/mid.jpg", 300, "300x300")],
    };
    expect(pickThumbnail(thumb)).toBe("https://x/mid.jpg");
  });

  it("takes the first one when none is wide enough", () => {
    const thumb = { resolutions: [res("https://x/tiny.jpg", 50, "50x50"), res("https://x/tinier.jpg", 40, "40x40")] };
    expect(pickThumbnail(thumb)).toBe("https://x/tiny.jpg");
  });

  it("skips non-http(s) urls and returns null without a thumbnail", () => {
    expect(pickThumbnail({ resolutions: [res("javascript:alert(1)", 140, "140x140")] })).toBeNull();
    expect(pickThumbnail({ resolutions: [] })).toBeNull();
    expect(pickThumbnail(undefined)).toBeNull();
  });

  it("skips thumbnails on a private or loopback host", () => {
    const local = res("http://127.0.0.1/140.jpg", 140, "140x140");
    expect(pickThumbnail({ resolutions: [local] })).toBeNull();
    expect(pickThumbnail({ resolutions: [local, res("https://x/300.jpg", 300, "300x300")] })).toBe("https://x/300.jpg");
  });
});
