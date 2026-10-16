import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeEntities, extractPreview, fetchPreview, hostOf, isAllowedUrl, truncate } from "./articlePreview";

const BASE = "https://www.tijd.be/markten/kbc.html";

// The body repeats an og tag on purpose: only the <head> may be read.
function page(head: string): string {
  return `<!doctype html><html><head><title>x</title>${head}</head><body><meta property="og:description" content="from the body"></body></html>`;
}

describe("extractPreview", () => {
  it("prefers og over twitter over the plain description", () => {
    const all = `<meta name="description" content="plain"><meta name="twitter:description" content="twitter"><meta property="og:description" content="og">`;
    expect(extractPreview(page(all), "Titel", BASE).summary).toBe("og");
    expect(extractPreview(page(`<meta name="description" content="plain"><meta name="twitter:description" content="twitter">`), "Titel", BASE).summary).toBe("twitter");
    expect(extractPreview(page(`<meta name="description" content="plain">`), "Titel", BASE).summary).toBe("plain");
  });

  it("reads attributes in any order and quoting style", () => {
    const html = page(`<meta content='Intro hier' property='og:description'><meta content="https://img.tijd.be/a.jpg" name="ogImg" property="og:image">`);
    expect(extractPreview(html, "Titel", BASE)).toEqual({ image_url: "https://img.tijd.be/a.jpg", summary: "Intro hier" });
  });

  it("falls back to twitter:image", () => {
    const html = page(`<meta name="twitter:image" content="https://img.tijd.be/t.jpg">`);
    expect(extractPreview(html, "Titel", BASE).image_url).toBe("https://img.tijd.be/t.jpg");
  });

  it("decodes entities and collapses whitespace", () => {
    const html = page(`<meta property="og:description" content="KBC &amp; ING  verhogen&#39;s
      rente &#x27;fors&#x27; &quot;nu&quot; &hellip;">`);
    expect(extractPreview(html, "Titel", BASE).summary).toBe(`KBC & ING verhogen's rente 'fors' "nu" …`);
  });

  it("strips tags that appear after decoding", () => {
    const html = page(`<meta property="og:description" content="&lt;p&gt;Intro &lt;b&gt;vet&lt;/b&gt;&lt;/p&gt;">`);
    expect(extractPreview(html, "Titel", BASE).summary).toBe("Intro vet");
  });

  it("resolves a relative image url against the page url", () => {
    expect(extractPreview(page(`<meta property="og:image" content="/img/a.jpg">`), "Titel", BASE).image_url).toBe(
      "https://www.tijd.be/img/a.jpg",
    );
  });

  it("drops an image that isn't http(s)", () => {
    expect(extractPreview(page(`<meta property="og:image" content="data:image/png;base64,AAAA">`), "Titel", BASE).image_url).toBeNull();
  });

  it("drops an image on a private or loopback host", () => {
    expect(extractPreview(page(`<meta property="og:image" content="http://192.168.1.1/x.jpg">`), "Titel", BASE).image_url).toBeNull();
    expect(extractPreview(page(`<meta property="og:image" content="http://localhost/x.jpg">`), "Titel", BASE).image_url).toBeNull();
  });

  it("drops an intro that only repeats the title", () => {
    const html = page(`<meta property="og:description" content="Lees &quot;Groei  Techwolf internationaal&quot; op Bloovi.">`);
    expect(extractPreview(html, "Groei Techwolf Internationaal", BASE).summary).toBeNull();
  });

  it("truncates a long intro", () => {
    const html = page(`<meta property="og:description" content="${"woord ".repeat(100)}">`);
    const { summary } = extractPreview(html, "Titel", BASE);
    expect(summary!.length).toBeLessThanOrEqual(300);
    expect(summary!.endsWith("woord…")).toBe(true);
  });

  it("only reads the head", () => {
    expect(extractPreview(page(""), "Titel", BASE)).toEqual({ image_url: null, summary: null });
  });

  it("keeps a '>' inside a quoted attribute value", () => {
    const html = page(`<meta property="og:description" content="Wall Street > Europe">`);
    expect(extractPreview(html, "Titel", BASE).summary).toBe("Wall Street > Europe");
  });

  it("stays fast on a huge malformed tag", () => {
    const cases: [string, string | null][] = [
      [page("<meta " + "a".repeat(200_000) + ">"), null],
      [page('<meta property="og:description" content="' + "&lt;".repeat(100_000) + '">'), "skip"],
      // Every start of a tag has to be rejected without rescanning the rest of the input.
      [page("<meta ".repeat(80_000)), null],
      [page("<meta '" + "<meta ".repeat(80_000)), null],
      // Under the per-tag cap, so ATTR runs on each of them.
      [page(("<meta " + "a".repeat(4000) + ">").repeat(120)), null],
    ];
    for (const [html, summary] of cases) {
      const start = performance.now();
      const result = extractPreview(html, "Titel", BASE);
      expect(performance.now() - start).toBeLessThan(200);
      if (summary !== "skip") expect(result.summary).toBe(summary);
    }
  });

  it("reads the whole input when there is no </head>", () => {
    expect(extractPreview(`<meta property="og:description" content="Intro">`, "Titel", BASE).summary).toBe("Intro");
  });
});

describe("decodeEntities", () => {
  it("leaves unknown entities and plain ampersands alone", () => {
    expect(decodeEntities("A &bogus; B & C &#0; D")).toBe("A &bogus; B & C &#0; D");
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("kort")).toBe("kort");
  });

  it("cuts at a word boundary within the limit and appends an ellipsis", () => {
    const out = truncate("woord ".repeat(100).trim());
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("woord…")).toBe(true);
  });

  it("hard-cuts text without spaces", () => {
    expect(truncate("x".repeat(400))).toBe("x".repeat(299) + "…");
  });
});

describe("isAllowedUrl", () => {
  it.each(["https://www.tijd.be/a", "http://example.com/x?y=1", "https://8.8.8.8/"])("allows %s", (u) => {
    expect(isAllowedUrl(u)).toBe(true);
  });

  it.each([
    "ftp://example.com/a",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://localhost:3100/api",
    "http://app.localhost/",
    "http://localhost./",
    "http://app.localhost./",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://2130706433/",
    "not a url",
  ])("rejects %s", (u) => {
    expect(isAllowedUrl(u)).toBe(false);
  });
});

describe("fetchPreview", () => {
  const OG = page(`<meta property="og:description" content="Intro"><meta property="og:image" content="/img/a.jpg">`);

  function html(body: string | Uint8Array, init: ResponseInit = {}, finalUrl?: string): Response {
    const res = new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
    if (finalUrl) Object.defineProperty(res, "url", { value: finalUrl });
    return res;
  }

  const fetchMock = vi.fn();
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });
  function stub(impl: () => Promise<Response>) {
    fetchMock.mockImplementation(impl);
    vi.stubGlobal("fetch", fetchMock);
  }

  it("returns the page's preview with an honest user agent and a timeout", async () => {
    stub(async () => html(OG));

    const out = await fetchPreview(BASE, "Titel");

    expect(out).toEqual({ kind: "ok", image_url: "https://www.tijd.be/img/a.jpg", summary: "Intro" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.headers["User-Agent"]).toMatch(/^trade-app-linkpreview\//);
    expect(init.headers["Accept-Language"]).toBe("nl-BE,nl;q=0.9,en;q=0.8");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves the image against the final url after a redirect", async () => {
    stub(async () => html(OG, {}, "https://www.standaard.be/cnt/x"));

    const out = await fetchPreview("https://example.com/short", "Titel");

    expect(out).toMatchObject({ kind: "ok", image_url: "https://www.standaard.be/img/a.jpg" });
  });

  it("treats a consent-wall redirect as none", async () => {
    const wall = page(`<meta property="og:description" content="Yahoo maakt deel uit van de Yahoo merkenfamilie">`);
    stub(async () => html(wall, {}, "https://consent.yahoo.com/v2/collectConsent?sessionId=x"));

    expect(await fetchPreview("https://finance.yahoo.com/news/a.html", "Titel")).toEqual({ kind: "none", reason: "consent wall" });
  });

  it.each([403, 404, 410])("settles a %i as none", async (status) => {
    stub(async () => html("nope", { status }));
    expect(await fetchPreview(BASE, "Titel")).toEqual({ kind: "none", reason: String(status) });
  });

  it.each([429, 500, 503])("retries a %i", async (status) => {
    stub(async () => html("busy", { status }));
    expect(await fetchPreview(BASE, "Titel")).toEqual({ kind: "retry", reason: String(status) });
  });

  it("retries on a network error or timeout", async () => {
    stub(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await fetchPreview(BASE, "Titel")).kind).toBe("retry");

    stub(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect((await fetchPreview(BASE, "Titel")).kind).toBe("retry");
  });

  it("names the cause code of a failed fetch, never the cause's message", async () => {
    stub(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("header overflow at https://finance.yahoo.com/geheim"), { code: "UND_ERR_HEADERS_OVERFLOW" }),
      });
    });
    expect(await fetchPreview(BASE, "Titel")).toEqual({ kind: "retry", reason: "fetch failed (UND_ERR_HEADERS_OVERFLOW)" });
  });

  it("names the cause code when reading the body fails", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
      },
    });
    stub(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }));
    expect(await fetchPreview(BASE, "Titel")).toEqual({ kind: "retry", reason: "terminated (UND_ERR_SOCKET)" });
  });

  it("settles a non-HTML answer as none", async () => {
    stub(async () => html("%PDF", { headers: { "content-type": "application/pdf" } }));
    expect(await fetchPreview(BASE, "Titel")).toEqual({ kind: "none", reason: "not html" });
  });

  it("never fetches a url it isn't allowed to", async () => {
    stub(async () => html(OG));
    expect(await fetchPreview("http://127.0.0.1:3100/api/diagnostics", "Titel")).toEqual({ kind: "none", reason: "url not allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops reading after 512 KB", async () => {
    const late = `<html><head>${"x".repeat(600 * 1024)}<meta property="og:description" content="te laat"></head></html>`;
    stub(async () => html(late));
    expect(await fetchPreview(BASE, "Titel")).toEqual({ kind: "ok", image_url: null, summary: null });
  });

  it("decodes the charset from the content type", async () => {
    // "café" in windows-1252: é = 0xE9
    const bytes = new Uint8Array([...new TextEncoder().encode(`<head><meta property="og:description" content="caf`), 0xe9, ...new TextEncoder().encode(`"></head>`)]);
    stub(async () => html(bytes, { headers: { "content-type": "text/html; charset=windows-1252" } }));
    expect(await fetchPreview(BASE, "Titel")).toMatchObject({ kind: "ok", summary: "café" });
  });
});

describe("hostOf", () => {
  it("returns the hostname, or an empty string for an unparseable url", () => {
    expect(hostOf("https://www.tijd.be/a?b=1")).toBe("www.tijd.be");
    expect(hostOf("not a url")).toBe("");
  });
});
