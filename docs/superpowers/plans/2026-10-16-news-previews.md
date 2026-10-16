# News article previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every news article a small image and the publisher's own intro, with a compact/extended toggle on the news page.

**Architecture:** Yahoo's search thumbnail is stored at ingest. After each refresh round (and after a new follow) a separate enrichment step visits every article whose preview isn't settled yet, once: Yahoo links directly, Google links after an unofficial decode to the publisher URL. It reads only the page's `<head>` meta tags (`og:*`, `twitter:*`, `description`) and stores `image_url` + `summary` in `news_articles`. The page shows them in the extended view and hot-links the images.

**Tech Stack:** Node 22 `fetch` / `AbortSignal.timeout` / `TextDecoder`, better-sqlite3, vitest; Angular 21 standalone + signals, Bootstrap 5, Karma/Jasmine.

**Spec:** `docs/superpowers/specs/2026-10-15-news-tab-design.md`, section "Addendum (2026-10-16): article previews" (line ~333 onward). Read the addendum before starting any task.

## Global Constraints

- No new dependencies (no HTML parser, no image library). Node ≥ 22 built-ins only.
- Migration number: **6** (`SCHEMA_VERSION = 6`); columns `image_url TEXT`, `summary TEXT`, `preview_at TEXT`.
- Intro: at most **300** characters including the trailing `…`, cut at the last word boundary (hard cut when there is no space).
- Page fetches: timeout **5000 ms**, body read capped at **512 KB**, link-preview `User-Agent` (`trade-app-linkpreview/1.0`, Ruling 10; the browser UA stays for Google's decode), `Accept-Language: nl-BE,nl;q=0.9,en;q=0.8`.
- Enrichment: **4** at a time; **50** per round; **20** per new follow; circuit breaker after **3** consecutive decode failures.
- Only `http(s)` URLs are fetched or stored as `image_url`; `localhost`, `*.localhost` and loopback/private/link-local IP literals are refused.
- Logs never contain an article's full URL or title (keywords leak through them; warnings become Sentry breadcrumbs). Per article: `debug`, host + reason. Per call: one `info` line with counts.
- `providerHealth` operations: `google`/`decode` and `yahoo`/`article` only. Publisher pages are not tracked.
- Frontend: thumbnail 64×64, `loading="lazy"`, `referrerpolicy="no-referrer"`; toggle stored via `persistedString('news.view', 'extended', ['compact', 'extended'])`; intro rendered by interpolation only (never `innerHTML`).
- Style: backend sources single quotes, backend tests double quotes, frontend single quotes; 2-space indent; 100-col lines. Backend comments in English; frontend comments and UI copy in Dutch. Templates use `@if`/`@for`.
- Commits: one per task, message `wip(news): <what>`, **no** `Co-Authored-By` trailer (project CLAUDE.md). Never rewrite history on `main`.

## Review Focus

- A publisher URL that redirects to a consent wall (`consent.yahoo.com`, `guce.yahoo.com`, `myprivacy.dpgmedia.be`) must not store the consent page's boilerplate as the intro → Task 4 test "treats a consent-wall redirect as none".
- A decoded Google URL that still points at a Google host must never be fetched (its `og:description` is Google News' own blurb) → Task 6 test "treats a decoded url on a Google host as a failed decode".
- An `og:description` that contains HTML tags once entities are decoded (`&lt;p&gt;Intro&lt;/p&gt;`) must show as plain text, not as literal `<p>` → Task 3 test "strips tags that appear after decoding".
- A relative `og:image` on a page reached through a redirect resolves against the final URL, not the requested one → Task 4 test "resolves the image against the final url after a redirect".
- A long unbroken title or intro in the extended view must wrap instead of widening the page → Task 8 test "laat lange woorden afbreken in de uitgebreide weergave".

---

## Commands

- Backend single file: `cd backend && npx vitest run src/path/file.test.ts`
- Backend all + types: `cd backend && npx vitest run && npx tsc --noEmit`
- Frontend: `cd frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless`
  (single spec: add `--include src/app/pages/news/news.component.spec.ts`)

---

### Task 1: Storage + API contract (migration 6, queries, route)

**Files:**
- Modify: `backend/src/schema.ts` (bump `SCHEMA_VERSION`, add `if (current < 6)` block after the `current < 5` block)
- Modify: `backend/src/services/providers/types.ts` (`NewsItem`)
- Modify: `backend/src/services/providers/yahooNews.ts` (`toNewsItem`: `image_url: null`)
- Modify: `backend/src/services/providers/googleNews.ts` (`parseGoogleNewsRss`: `image_url: null`)
- Modify: `backend/src/queries/news.ts`
- Modify: `backend/src/routes/news.ts` (`newsPayload`)
- Create: `backend/src/schema.test.ts`
- Modify tests: `backend/src/queries/news.test.ts`, `backend/src/routes/news.test.ts`, `backend/src/services/newsService.test.ts`, `backend/src/services/providers/yahooNews.test.ts`, `backend/src/services/providers/googleNews.test.ts`

**Interfaces:**
- Produces:
  - `NewsItem.image_url: string | null`
  - `NewsArticleRow` gains `summary: string | null; preview_at: string | null`
  - `interface PendingPreview { id: string; title: string; url: string; source: 'yahoo' | 'google'; image_url: string | null }`
  - `listPendingPreviews(opts: { since: string; limit: number; topic?: TopicRef }): PendingPreview[]`
  - `setArticleUrl(id: string, url: string): void`
  - `settlePreview(id: string, found: { image_url: string | null; summary: string | null } | null, at: string): void`
  - API `NewsArticle` gains `image_url`, `summary` (and never exposes `preview_at`)

- [ ] **Step 1: Write the failing migration test** — create `backend/src/schema.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { logger } from "./helpers/logger";
import { runMigrations } from "./schema";

describe("runMigrations", () => {
  it("adds the article preview columns in migration 6 and is idempotent", () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});
    const mem = new Database(":memory:");

    runMigrations(mem);
    runMigrations(mem);

    const cols = (mem.prepare("PRAGMA table_info(news_articles)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(["image_url", "summary", "preview_at"]));
    const { v } = mem.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
    expect(v).toBe(6);
  });
});
```

- [ ] **Step 2: Write the failing query tests** — in `backend/src/queries/news.test.ts`, add `image_url: null` to the `item()` helper's object, add `listPendingPreviews, setArticleUrl, settlePreview` to the import from `./news`, and append:

```ts
const SINCE = "2026-10-01T00:00:00.000Z";

describe("article previews", () => {
  it("lists unsettled articles newest first, within the cutoff and the limit", () => {
    saveArticles(
      NVDA,
      [
        item("old", "2026-09-01T08:00:00.000Z"),
        item("a", "2026-10-14T08:00:00.000Z"),
        item("b", "2026-10-15T08:00:00.000Z"),
        item("c", "2026-10-13T08:00:00.000Z"),
      ],
      T,
    );
    settlePreview("c", null, T);

    expect(listPendingPreviews({ since: SINCE, limit: 10 }).map((p) => p.id)).toEqual(["b", "a"]);
    expect(listPendingPreviews({ since: SINCE, limit: 1 }).map((p) => p.id)).toEqual(["b"]);
  });

  it("narrows to one topic's articles", () => {
    saveArticles(NVDA, [item("n1")], T);
    saveArticles(ECB, [item("e1")], T);

    expect(listPendingPreviews({ since: SINCE, limit: 10, topic: ECB }).map((p) => p.id)).toEqual(["e1"]);
  });

  it("stores the search thumbnail at ingest and keeps it over the page image", () => {
    saveArticles(NVDA, [{ ...item("a"), image_url: "https://img.example/thumb.jpg" }], T);
    settlePreview("a", { image_url: "https://img.example/og.jpg", summary: "Intro" }, "2026-10-15T11:00:00.000Z");

    expect(listArticlesFor([NVDA])[0]).toMatchObject({
      image_url: "https://img.example/thumb.jpg",
      summary: "Intro",
      preview_at: "2026-10-15T11:00:00.000Z",
    });
  });

  it("fills a missing image from the page and settles a 'none' without fields", () => {
    saveArticles(NVDA, [item("a"), item("b")], T);
    settlePreview("a", { image_url: "https://img.example/og.jpg", summary: null }, T);
    settlePreview("b", null, T);

    const byId = new Map(listArticlesFor([NVDA]).map((x) => [x.id, x]));
    expect(byId.get("a")).toMatchObject({ image_url: "https://img.example/og.jpg", summary: null, preview_at: T });
    expect(byId.get("b")).toMatchObject({ image_url: null, summary: null, preview_at: T });
    expect(listPendingPreviews({ since: SINCE, limit: 10 })).toEqual([]);
  });

  it("replaces an article's url", () => {
    saveArticles(ECB, [item("g")], T);
    setArticleUrl("g", "https://www.tijd.be/x.html");

    expect(listArticlesFor([ECB])[0].url).toBe("https://www.tijd.be/x.html");
  });
});
```

- [ ] **Step 3: Update the API contract test** — in `backend/src/routes/news.test.ts`, add `image_url: null` to the `item()` helper, and in the test "follows a keyword, fetches it at once and lists its articles as new" add to the expected article object (after `source: "google",`):

```ts
        image_url: null,
        summary: null,
```

(`preview_at` must **not** appear; the `toEqual` enforces that.)

- [ ] **Step 4: Keep the other fixtures type-correct** — add `image_url: null` to the `item()` helper in `backend/src/services/newsService.test.ts`; in `backend/src/services/providers/yahooNews.test.ts` ("maps a Yahoo item to a NewsItem") and `backend/src/services/providers/googleNews.test.ts` ("maps items, strips the ' - source' suffix…") add `image_url: null,` after `source: …,` in the expected object.

- [ ] **Step 5: Run to verify failure**

Run: `cd backend && npx vitest run src/schema.test.ts src/queries/news.test.ts src/routes/news.test.ts`
Expected: FAIL — `v` is 5 / columns missing; `listPendingPreviews is not a function`; route body lacks `image_url`.

- [ ] **Step 6: Implement** —

`backend/src/schema.ts`: `const SCHEMA_VERSION = 6;` and after the `current < 5` block:

```ts
  if (current < 6) {
    db.exec(`
      -- Article previews (issue #11 addendum): a thumbnail and the publisher's own intro
      -- (og:description), read once per article by the enrichment step. preview_at NULL =
      -- still to try; a transient failure leaves it NULL so the next round retries.
      ALTER TABLE news_articles ADD COLUMN image_url  TEXT;
      ALTER TABLE news_articles ADD COLUMN summary    TEXT;
      ALTER TABLE news_articles ADD COLUMN preview_at TEXT;
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(6);
  }
```

`backend/src/services/providers/types.ts` — add to `NewsItem` after `source`:

```ts
  /** Thumbnail (http(s)). Yahoo's search result carries one; Google's RSS never does. */
  image_url: string | null;
```

`yahooNews.ts` `toNewsItem` and `googleNews.ts` `parseGoogleNewsRss`: add `image_url: null,` after `source: …,` in the returned/pushed object (Task 2 replaces the Yahoo one).

`backend/src/queries/news.ts`:

```ts
export interface NewsArticleRow extends NewsItem {
  fetched_at: string;
  summary: string | null;
  /** When the preview was settled; null = still to try. Internal, never sent to the page. */
  preview_at: string | null;
}

/** An article still waiting for its preview (image + intro). */
export interface PendingPreview {
  id: string;
  title: string;
  url: string;
  source: NewsItem['source'];
  image_url: string | null;
}
```

In `saveArticles` change the insert to:

```ts
    INSERT OR IGNORE INTO news_articles (id, title, publisher, url, published_at, source, image_url, fetched_at)
    VALUES (@id, @title, @publisher, @url, @published_at, @source, @image_url, @fetched_at)
```

Append:

```ts
/**
 * Articles whose preview isn't settled yet, newest first. `topic` narrows it to one topic's
 * articles (a fresh follow); `since` skips what retention is about to prune anyway.
 */
export function listPendingPreviews(opts: {
  since: string;
  limit: number;
  topic?: TopicRef;
}): PendingPreview[] {
  const byTopic = opts.topic
    ? `AND EXISTS (SELECT 1 FROM news_article_topics t
                   WHERE t.article_id = a.id AND t.kind = @kind AND t.value = @value)`
    : '';
  return db
    .prepare(`
      SELECT a.id, a.title, a.url, a.source, a.image_url
      FROM news_articles a
      WHERE a.preview_at IS NULL AND a.published_at >= @since ${byTopic}
      ORDER BY a.published_at DESC, a.id
      LIMIT @limit
    `)
    .all({
      since: opts.since,
      limit: opts.limit,
      ...(opts.topic ? { kind: opts.topic.kind, value: opts.topic.value } : {}),
    }) as PendingPreview[];
}

/** A Google link decoded to the publisher's URL replaces the news.google.com redirect. */
export function setArticleUrl(id: string, url: string): void {
  db.prepare(`UPDATE news_articles SET url = ? WHERE id = ?`).run(url, id);
}

/**
 * Settle an article's preview. `found` is what the page gave, or null when nothing usable
 * came back. An image already stored (Yahoo's search thumbnail) wins over the page's.
 */
export function settlePreview(
  id: string,
  found: { image_url: string | null; summary: string | null } | null,
  at: string,
): void {
  db.prepare(`
    UPDATE news_articles
    SET image_url = COALESCE(image_url, @image_url), summary = @summary, preview_at = @at
    WHERE id = @id
  `).run({ id, at, image_url: found?.image_url ?? null, summary: found?.summary ?? null });
}
```

`backend/src/routes/news.ts` `newsPayload()` — drop the internal column from the payload:

```ts
  // preview_at is enrichment bookkeeping, not part of the API.
  const articles = listArticlesFor(topics).map(({ fetched_at, preview_at, ...article }) => ({
```

- [ ] **Step 7: Run to verify pass**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src
git commit -m "wip(news): migration 6 and preview storage"
```

---

### Task 2: Yahoo thumbnail at ingest

**Files:**
- Modify: `backend/src/services/providers/yahooNews.ts`
- Test: `backend/src/services/providers/yahooNews.test.ts`

**Interfaces:**
- Consumes: `NewsItem.image_url` (Task 1)
- Produces: `export function pickThumbnail(thumbnail: YahooThumbnail | undefined): string | null`

- [ ] **Step 1: Write the failing tests** — add `pickThumbnail` to the import and append:

```ts
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
});
```

And in `describe("fetchTickerNews")`:

```ts
  it("carries the search thumbnail", async () => {
    const withThumb = {
      ...raw("a", ["ASML"]),
      thumbnail: { resolutions: [{ url: "https://s.yimg.com/140.jpg", width: 140, height: 140, tag: "140x140" }] },
    };
    search.mockResolvedValue({ news: [withThumb] });

    const [item] = await fetchTickerNews("ASML", null);

    expect(item.image_url).toBe("https://s.yimg.com/140.jpg");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/providers/yahooNews.test.ts`
Expected: FAIL — `pickThumbnail is not a function`; `image_url` is `null`.

- [ ] **Step 3: Implement** — in `yahooNews.ts`:

```ts
interface YahooThumbnail {
  resolutions?: { url?: string; width?: number; height?: number; tag?: string }[];
}
```

Add `thumbnail?: YahooThumbnail;` to `YahooNewsRaw`, then:

```ts
const THUMB_TAG = '140x140';
const THUMB_MIN_WIDTH = 100;

/**
 * The search result's ready-made 140×140 crop when there is one (small and square — what the
 * timeline shows), else the smallest one wide enough, else whatever comes first.
 */
export function pickThumbnail(thumbnail: YahooThumbnail | undefined): string | null {
  const usable = (thumbnail?.resolutions ?? []).filter(
    (r): r is { url: string; width?: number; tag?: string } =>
      typeof r.url === 'string' && HTTP_URL.test(r.url),
  );
  const tagged = usable.find((r) => r.tag === THUMB_TAG);
  if (tagged) return tagged.url;
  const wideEnough = usable
    .filter((r) => (r.width ?? 0) >= THUMB_MIN_WIDTH)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (wideEnough[0] ?? usable[0])?.url ?? null;
}
```

(`HTTP_URL` is the module's existing `/^https?:\/\//i` constant, used for article links.)

In `toNewsItem` replace `image_url: null,` with `image_url: pickThumbnail(raw.thumbnail),`.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/providers/yahooNews.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/providers/yahooNews.ts backend/src/services/providers/yahooNews.test.ts
git commit -m "wip(news): yahoo search thumbnail"
```

---

### Task 3: Preview extraction (pure)

**Files:**
- Create: `backend/src/services/articlePreview.ts`
- Test: `backend/src/services/articlePreview.test.ts`

**Interfaces:**
- Produces:
  - `export interface Preview { image_url: string | null; summary: string | null }`
  - `export function extractPreview(html: string, title: string, baseUrl: string): Preview`
  - `export function decodeEntities(s: string): string`
  - `export function truncate(s: string, max?: number): string` (default 300)
  - `export function isAllowedUrl(raw: string): boolean`

- [ ] **Step 1: Write the failing tests** — create `backend/src/services/articlePreview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeEntities, extractPreview, isAllowedUrl, truncate } from "./articlePreview";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/articlePreview.test.ts`
Expected: FAIL — cannot resolve `./articlePreview`.

- [ ] **Step 3: Implement** — create `backend/src/services/articlePreview.ts`:

```ts
import { isIP } from 'node:net';

/**
 * Article previews (issue #11 addendum): the image and intro a publisher puts in its page's
 * <head> for social sharing (og:*, twitter:*, description). Never the article body.
 */

export interface Preview {
  image_url: string | null;
  summary: string | null;
}

const SUMMARY_MAX = 300;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', euro: '€',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â',
  auml: 'ä', iuml: 'ï', icirc: 'î', oacute: 'ó', ocirc: 'ô', ouml: 'ö', uuml: 'ü', ucirc: 'û',
  ccedil: 'ç', Eacute: 'É',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

const META_TAG = /<meta\b[^>]*>/gi;
const ATTR = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** property/name → content of every <meta> in the head; the first occurrence wins. */
function metaTags(html: string): Map<string, string> {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;
  const out = new Map<string, string>();
  for (const [tag] of head.matchAll(META_TAG)) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(ATTR)) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
    // Yahoo writes `name="ogImg" property="og:image"`: property is the meaningful one.
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content != null && !out.has(key)) out.set(key, content);
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Decode, then strip tags some publishers double-escape into the attribute. */
function cleanText(s: string): string {
  return decodeEntities(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** At most `max` characters including the ellipsis, cut at the last space when there is one. */
export function truncate(s: string, max = SUMMARY_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

function resolveHttpUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function extractPreview(html: string, title: string, baseUrl: string): Preview {
  const meta = metaTags(html);
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)?.trim()).find((v) => v);
  const rawImage = pick('og:image', 'twitter:image');
  const rawText = pick('og:description', 'twitter:description', 'description');

  const image_url = rawImage ? resolveHttpUrl(decodeEntities(rawImage), baseUrl) : null;
  let summary = rawText ? cleanText(rawText) : '';
  // Boilerplate like `Lees "<title>" op Bloovi.` adds nothing next to the title itself.
  const t = normalize(title);
  if (t && normalize(summary).includes(t)) summary = '';
  return { image_url, summary: summary ? truncate(summary) : null };
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped (WHATWG URL normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1): never a publisher.
  if (/^::ffff:/i.test(ip)) return true;
  return /^(fc|fd|fe[89ab])/i.test(ip);
}

/**
 * Only http(s), and never this machine or the local network: the URLs come from third
 * parties (Yahoo, Google, a decoded redirect). A cheap SSRF guard — DNS isn't resolved and
 * redirects aren't re-checked, which is acceptable for a single-user local app.
 */
export function isAllowedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (isIP(host) === 4) return !isPrivateIPv4(host);
  if (isIP(host) === 6) return !isPrivateIPv6(host);
  return true;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/articlePreview.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/articlePreview.ts backend/src/services/articlePreview.test.ts
git commit -m "wip(news): article preview extraction"
```

---

### Task 4: Fetching a page's preview

**Files:**
- Modify: `backend/src/helpers/constants.ts` (append)
- Modify: `backend/src/services/articlePreview.ts` (append `fetchPreview`)
- Test: `backend/src/services/articlePreview.test.ts` (append)

**Interfaces:**
- Consumes: `extractPreview`, `isAllowedUrl` (Task 3)
- Produces:
  - constants `BROWSER_HEADERS: Record<string, string>`, `PAGE_FETCH_TIMEOUT_MS = 5000`, `NEWS_PREVIEWS_PER_ROUND = 50`, `NEWS_PREVIEWS_PER_FOLLOW = 20`
  - `export type PreviewOutcome = ({ kind: 'ok' } & Preview) | { kind: 'none'; reason: string } | { kind: 'retry'; reason: string }`
  - `export async function fetchPreview(url: string, title: string): Promise<PreviewOutcome>`

- [ ] **Step 1: Write the failing tests** — in `articlePreview.test.ts` change the vitest import to `import { afterEach, describe, expect, it, vi } from "vitest";`, add `fetchPreview` to the `./articlePreview` import, and append:

```ts
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

  it("returns the page's preview with browser headers and a timeout", async () => {
    stub(async () => html(OG));

    const out = await fetchPreview(BASE, "Titel");

    expect(out).toEqual({ kind: "ok", image_url: "https://www.tijd.be/img/a.jpg", summary: "Intro" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.headers["User-Agent"]).toMatch(/Mozilla/);
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/articlePreview.test.ts`
Expected: FAIL — `fetchPreview is not a function`.

- [ ] **Step 3: Implement** — append to `backend/src/helpers/constants.ts`:

```ts
/** Article previews fetched per refresh round; the rest wait for the next round. */
export const NEWS_PREVIEWS_PER_ROUND = 50;
/** Previews fetched right after following a topic (one Google answer holds at most 20 items). */
export const NEWS_PREVIEWS_PER_FOLLOW = 20;
/** Publisher pages and Google's link decode: a bare client gets blocked more often. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8',
};
export const PAGE_FETCH_TIMEOUT_MS = 5000;
```

Append to `articlePreview.ts` (add `import { errorMessage } from '../helpers/errors';` and `import { BROWSER_HEADERS, PAGE_FETCH_TIMEOUT_MS } from '../helpers/constants';` at the top):

```ts
export type PreviewOutcome =
  | ({ kind: 'ok' } & Preview)
  | { kind: 'none'; reason: string }
  | { kind: 'retry'; reason: string };

const MAX_BYTES = 512 * 1024;

/** Cookie walls answer 200 with their own og tags; storing those would be worse than nothing. */
const CONSENT_HOST = /^(consent|guce|myprivacy)\./i;

/** Read at most `max` bytes of the body, then drop the connection. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Fetch one article page and read its preview. Never throws: `none` settles the article
 * (a 4xx, not HTML, a consent wall, a refused URL), `retry` leaves it for the next round
 * (network, timeout, 429, 5xx).
 */
export async function fetchPreview(url: string, title: string): Promise<PreviewOutcome> {
  if (!isAllowedUrl(url)) return { kind: 'none', reason: 'url not allowed' };
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'retry', reason: errorMessage(err) };
  }
  const finalUrl = res.url || url;
  const drop = () => res.body?.cancel().catch(() => {});
  if (res.status === 429 || res.status >= 500) {
    await drop();
    return { kind: 'retry', reason: String(res.status) };
  }
  if (!res.ok) {
    await drop();
    return { kind: 'none', reason: String(res.status) };
  }
  if (CONSENT_HOST.test(hostOf(finalUrl))) {
    await drop();
    return { kind: 'none', reason: 'consent wall' };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
    await drop();
    return { kind: 'none', reason: 'not html' };
  }
  try {
    const html = decodeBody(await readCapped(res, MAX_BYTES), type);
    return { kind: 'ok', ...extractPreview(html, title, finalUrl) };
  } catch (err) {
    return { kind: 'retry', reason: errorMessage(err) };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/articlePreview.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/helpers/constants.ts backend/src/services/articlePreview.ts backend/src/services/articlePreview.test.ts
git commit -m "wip(news): fetch an article page's preview"
```

---

### Task 5: Google link decode

**Files:**
- Modify: `backend/src/services/providers/googleNews.ts` (append)
- Test: `backend/src/services/providers/googleNews.test.ts` (append)

**Interfaces:**
- Consumes: `BROWSER_HEADERS`, `PAGE_FETCH_TIMEOUT_MS` (Task 4)
- Produces:
  - `export async function resolveGoogleNewsUrl(guid: string): Promise<string>` — throws on any unexpected step
  - `export function parseDecodeResponse(text: string): string`

- [ ] **Step 1: Write the failing tests** — add `parseDecodeResponse, resolveGoogleNewsUrl` to the import and append:

```ts
describe("resolveGoogleNewsUrl", () => {
  const PAGE = `<html><body><c-wiz><div jscontroller="aLI87" data-n-a-id="AAA" data-n-a-ts="1760500000" data-n-a-sg="SIG_123"></div></c-wiz></body></html>`;
  // batchexecute: an anti-JSON prefix, then an envelope whose payload is itself a JSON string.
  const decoded = (payload: unknown) =>
    `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify(payload), null, null, null, "generic"], ["di", 42]])}\n\n25\n[["e",4,null,null,123]]`;

  function stubFetch(...responses: Response[]) {
    const fetchMock = vi.fn();
    for (const r of responses) fetchMock.mockResolvedValueOnce(r);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("trades the page's signature for the publisher url", async () => {
    const fetchMock = stubFetch(
      new Response(PAGE),
      new Response(decoded(["garturlres", "https://www.tijd.be/markten/kbc.html", 1])),
    );

    expect(await resolveGoogleNewsUrl("AAA")).toBe("https://www.tijd.be/markten/kbc.html");

    expect(fetchMock.mock.calls[0][0]).toBe("https://news.google.com/rss/articles/AAA");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://news.google.com/_/DotsSplashUi/data/batchexecute");
    expect(init.method).toBe("POST");
    const freq = JSON.parse(decodeURIComponent(String(init.body).replace(/^f\.req=/, "")));
    expect(freq[0][0][0]).toBe("Fbv4je");
    const inner = JSON.parse(freq[0][0][1]);
    expect(inner[0]).toBe("garturlreq");
    expect(inner.slice(2)).toEqual(["AAA", 1760500000, "SIG_123"]);
  });

  it("throws when the page has no signature", async () => {
    stubFetch(new Response("<html><body>consent</body></html>"));
    await expect(resolveGoogleNewsUrl("AAA")).rejects.toThrow(/signature/);
  });

  it("throws when the article page fails", async () => {
    stubFetch(new Response("gone", { status: 404 }));
    await expect(resolveGoogleNewsUrl("AAA")).rejects.toThrow(/404/);
  });

  it("throws on an unexpected decode answer", async () => {
    stubFetch(new Response(PAGE), new Response(")]}'\n\nnot json"));
    await expect(resolveGoogleNewsUrl("AAA")).rejects.toThrow(/unexpected/);
  });
});

describe("parseDecodeResponse", () => {
  it("rejects a payload that isn't garturlres", () => {
    const text = `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify(["other", "x"])]])}`;
    expect(() => parseDecodeResponse(text)).toThrow(/unexpected/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/providers/googleNews.test.ts`
Expected: FAIL — `resolveGoogleNewsUrl is not a function`.

- [ ] **Step 3: Implement** — in `googleNews.ts` add `import { BROWSER_HEADERS, PAGE_FETCH_TIMEOUT_MS } from '../../helpers/constants';` and append:

```ts
const DECODE_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

/**
 * Decode a news.google.com article link to the publisher's URL. Unofficial: the article page
 * carries a signature and a timestamp, and Google's own batchexecute RPC (`Fbv4je`) trades
 * them for the real URL. The scheme has changed before, so every step throws on a surprise;
 * the caller treats that as transient and counts it toward google/decode health.
 */
export async function resolveGoogleNewsUrl(guid: string): Promise<string> {
  const page = await fetch(`https://news.google.com/rss/articles/${encodeURIComponent(guid)}`, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
  });
  if (!page.ok) throw new Error(`article page answered ${page.status}`);
  const html = await page.text();
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) throw new Error('no decode signature on the article page');

  const request = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
      'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
    ],
    guid,
    Number(timestamp),
    signature,
  ]);
  const res = await fetch(DECODE_URL, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', request, null, 'generic']]])),
    signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`batchexecute answered ${res.status}`);
  return parseDecodeResponse(await res.text());
}

/** `)]}'` + blank line + a JSON envelope whose third field is the JSON-encoded payload. */
export function parseDecodeResponse(text: string): string {
  try {
    const envelope = JSON.parse(text.split('\n\n')[1]);
    const payload = JSON.parse(envelope[0][2]);
    if (payload[0] === 'garturlres' && typeof payload[1] === 'string') return payload[1];
  } catch {
    // fall through to the generic error: the details would only repeat Google's internals
  }
  throw new Error('unexpected batchexecute response');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/providers/googleNews.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/providers/googleNews.ts backend/src/services/providers/googleNews.test.ts
git commit -m "wip(news): decode google news links"
```

---

### Task 6: Enrichment step

**Files:**
- Create: `backend/src/services/newsPreviews.ts`
- Test: `backend/src/services/newsPreviews.test.ts`

**Interfaces:**
- Consumes: `listPendingPreviews`, `setArticleUrl`, `settlePreview`, `PendingPreview`, `TopicRef` (Task 1); `fetchPreview`, `isAllowedUrl`, `PreviewOutcome` (Tasks 3–4); `resolveGoogleNewsUrl` (Task 5); `recordFailure`/`recordSuccess` (`providerHealth.ts`)
- Produces:
  - `export interface EnrichOptions { since: string; limit: number; topic?: TopicRef; at: string }`
  - `export async function enrichPending(opts: EnrichOptions): Promise<void>` — never rejects for per-article problems

- [ ] **Step 1: Write the failing tests** — create `backend/src/services/newsPreviews.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/newsPreviews.test.ts`
Expected: FAIL — cannot resolve `./newsPreviews`.

- [ ] **Step 3: Implement** — create `backend/src/services/newsPreviews.ts`:

```ts
import { fetchPreview, isAllowedUrl, type PreviewOutcome } from './articlePreview';
import { resolveGoogleNewsUrl } from './providers/googleNews';
import { recordFailure, recordSuccess } from './providerHealth';
import {
  listPendingPreviews,
  setArticleUrl,
  settlePreview,
  type PendingPreview,
  type TopicRef,
} from '../queries/news';
import { logger } from '../helpers/logger';
import { errorMessage } from '../helpers/errors';

/**
 * Article previews (issue #11 addendum): once per article, read the image + intro its page
 * publishes for social sharing. Runs after a round's ingest and never fails it.
 *
 * `ok` and `none` settle an article (preview_at set); `retry` leaves it pending, so a later
 * round tries again — bounded by retention. Google links first go through the unofficial
 * decode; three decode failures in a row skip the rest of Google for this call, so a broken
 * decode doesn't hammer Google every round.
 *
 * Logs carry hosts and counts only: an article's URL or title can reveal a keyword.
 */

const CONCURRENCY = 4;
const DECODE_BREAKER = 3;

export interface EnrichOptions {
  /** Retention cutoff: older articles are about to be pruned. */
  since: string;
  limit: number;
  /** Only this topic's articles (a fresh follow). */
  topic?: TopicRef;
  /** Stamped into preview_at. */
  at: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '?';
  }
}

function onHost(url: string, domain: string): boolean {
  const host = hostOf(url);
  return host === domain || host.endsWith(`.${domain}`);
}

export async function enrichPending(opts: EnrichOptions): Promise<void> {
  const pending = listPendingPreviews(opts);
  if (pending.length === 0) return;

  const counts: Record<PreviewOutcome['kind'], number> = { ok: 0, none: 0, retry: 0 };
  let decodeFailures = 0;

  /** The publisher URL for a Google item, or null when the decode failed (stays pending). */
  async function decode(article: PendingPreview): Promise<string | null> {
    if (decodeFailures >= DECODE_BREAKER) return null;
    try {
      const url = await resolveGoogleNewsUrl(article.id);
      // A Google host here means the decode went wrong; its page describes Google News itself.
      if (onHost(url, 'google.com')) throw new Error('decoded to a Google page');
      decodeFailures = 0;
      recordSuccess('google', 'decode');
      return url;
    } catch (err) {
      decodeFailures++;
      recordFailure('google', 'decode', errorMessage(err));
      logger.debug('news', `preview: google decode failed (${errorMessage(err)})`);
      return null;
    }
  }

  async function enrichOne(article: PendingPreview): Promise<void> {
    let url = article.url;
    if (article.source === 'google') {
      const decoded = await decode(article);
      if (decoded == null) {
        counts.retry++;
        return;
      }
      if (!isAllowedUrl(decoded)) {
        settlePreview(article.id, null, opts.at);
        logger.debug('news', 'preview: decoded url refused');
        counts.none++;
        return;
      }
      setArticleUrl(article.id, decoded);
      url = decoded;
    }

    const outcome = await fetchPreview(url, article.title);
    counts[outcome.kind]++;
    if (outcome.kind === 'ok') {
      settlePreview(article.id, { image_url: outcome.image_url, summary: outcome.summary }, opts.at);
    } else {
      if (outcome.kind === 'none') settlePreview(article.id, null, opts.at);
      logger.debug('news', `preview: ${hostOf(url)} → ${outcome.reason}`);
    }

    // Yahoo's own article pages always carry an intro; a run without one means a consent
    // wall or a layout change. Publisher pages vary per site and aren't tracked.
    if (article.source === 'yahoo' && onHost(url, 'yahoo.com')) {
      if (outcome.kind === 'ok' && outcome.summary) recordSuccess('yahoo', 'article');
      else recordFailure('yahoo', 'article', outcome.kind === 'ok' ? 'page without intro' : outcome.reason);
    }
  }

  const queue = [...pending];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        await enrichOne(next);
      } catch (err) {
        counts.retry++;
        logger.debug('news', `preview failed: ${errorMessage(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  logger.info('news', `previews: ${counts.ok} ok, ${counts.none} none, ${counts.retry} retry`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/newsPreviews.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/newsPreviews.ts backend/src/services/newsPreviews.test.ts
git commit -m "wip(news): enrich articles with previews"
```

---

### Task 7: Wire enrichment into rounds and follows

**Files:**
- Modify: `backend/src/services/newsService.ts` (`runRefresh`, `refreshTopic`, new `enrichSafely`)
- Test: `backend/src/services/newsService.test.ts`
- Modify: `backend/src/routes/news.test.ts` (mock the enrichment step: no real network in route tests)

**Interfaces:**
- Consumes: `enrichPending`, `EnrichOptions` (Task 6); `NEWS_PREVIEWS_PER_ROUND`, `NEWS_PREVIEWS_PER_FOLLOW` (Task 4)
- Produces: no new exports. Behavior: a round = ingest all topics → `enrichPending({ since, limit: 50, at })` → prune; `refreshTopic` = ingest → (if the fetch succeeded) `enrichPending({ since, limit: 20, topic, at })`; `status.refreshing` stays true until enrichment finishes.

- [ ] **Step 1: Mock the step in the existing tests** — in `backend/src/services/newsService.test.ts` extend the hoisted mocks and mock the module:

```ts
const { fetchTickerNews, fetchKeywordNews, enrichPending } = vi.hoisted(() => ({
  fetchTickerNews: vi.fn(),
  fetchKeywordNews: vi.fn(),
  enrichPending: vi.fn(),
}));
vi.mock("./providers/yahooNews", () => ({ fetchTickerNews }));
vi.mock("./providers/googleNews", () => ({ fetchKeywordNews }));
vi.mock("./newsPreviews", () => ({ enrichPending }));
```

and in `beforeEach` add `enrichPending.mockReset().mockResolvedValue(undefined);`.

In `backend/src/routes/news.test.ts` add next to the other `vi.mock` calls:

```ts
vi.mock("../services/newsPreviews", () => ({ enrichPending: vi.fn().mockResolvedValue(undefined) }));
```

- [ ] **Step 2: Write the failing tests** — append to `newsService.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx vitest run src/services/newsService.test.ts`
Expected: FAIL — `enrichPending` never called.

- [ ] **Step 4: Implement** — in `newsService.ts` add `import { enrichPending, type EnrichOptions } from './newsPreviews';` and `NEWS_PREVIEWS_PER_FOLLOW, NEWS_PREVIEWS_PER_ROUND` to the constants import, then:

```ts
/** Previews are a bonus: nothing that goes wrong there may fail the round or the follow. */
async function enrichSafely(opts: Pick<EnrichOptions, 'limit' | 'topic'>): Promise<void> {
  try {
    await enrichPending({ ...opts, since: retentionCutoff(), at: newsNowIso() });
  } catch (err) {
    logger.warn('news', `previews failed: ${errorMessage(err)}`);
  }
}
```

In `runRefresh()`, inside the `try`, between the topic `for` loop and `pruneArticles(retentionCutoff());`:

```ts
    await enrichSafely({ limit: NEWS_PREVIEWS_PER_ROUND });
```

In `refreshTopic(topic)`, after the line `if (result !== 'ok') failedTopics.push(...)`:

```ts
  if (result === 'ok') {
    await enrichSafely({ limit: NEWS_PREVIEWS_PER_FOLLOW, topic: { kind: topic.kind, value: topic.value } });
  }
```

Update the module doc comment's round description to: "A round fetches every topic sequentially, stores articles + badges, fetches previews for new articles (newsPreviews.ts), then prunes past retention."

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: all PASS (route tests included — they must not hit the network).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/newsService.ts backend/src/services/newsService.test.ts backend/src/routes/news.test.ts
git commit -m "wip(news): fetch previews after each round and follow"
```

---

### Task 8: Frontend — model, toggle, extended view

**Files:**
- Modify: `frontend/src/app/models/index.ts` (`NewsArticle`)
- Modify: `frontend/src/app/pages/news/news.component.ts`
- Modify: `frontend/src/app/pages/news/news.component.html` (header + article `<li>`)
- Create: `frontend/src/app/pages/news/news.component.scss`
- Test: `frontend/src/app/pages/news/news.component.spec.ts`
- Modify: `frontend/src/app/utils/news-filter.spec.ts` (fixture gets the new fields)

**Interfaces:**
- Consumes: API `NewsArticle.image_url`, `NewsArticle.summary` (Task 1); `persistedString` (`utils/storage.ts`)
- Produces: `NewsComponent.view: WritableSignal<'compact' | 'extended'>`, `extended: Signal<boolean>`, `showImage(a): boolean`, `imageFailed(id): void`

- [ ] **Step 1: Update the model and fixtures** — in `models/index.ts` add to `NewsArticle` after `source`:

```ts
  /** Thumbnail (http(s)); null when the source and the page had none. */
  image_url: string | null;
  /** De eigen inleiding van de uitgever (og:description), max. 300 tekens. */
  summary: string | null;
```

In `utils/news-filter.spec.ts`'s `article()` helper add `image_url: null, summary: null,`.

- [ ] **Step 2: Write the failing tests** — in `news.component.spec.ts` change the `article` helper to accept overrides and add a storage reset:

```ts
function article(id: string, isNew: boolean, extra: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id,
    title: `Titel ${id}`,
    publisher: 'Bron',
    url: `https://example.com/${id}`,
    published_at: '2026-10-15T08:00:00.000Z',
    source: 'yahoo',
    image_url: null,
    summary: null,
    topics: [{ kind: 'TICKER', value: 'NVDA' }],
    is_new: isNew,
    ...extra,
  };
}
```

In the top-level `beforeEach` add `localStorage.removeItem('trade-app:news.view');`. Inside the `describe`, add:

```ts
  function openWith(articles: NewsArticle[]) {
    const fixture = open();
    http.expectOne(`${base}/news`).flush(response(articles, '2026-10-15T12:00:00.000Z'));
    flushSeen('2026-10-15T12:00:00.000Z');
    fixture.detectChanges();
    return fixture;
  }

  const WITH_PREVIEW = { image_url: 'https://img.example/a.jpg', summary: 'Korte inleiding' };

  it('toont standaard de uitgebreide weergave met afbeelding en inleiding', () => {
    const el: HTMLElement = openWith([article('a', false, WITH_PREVIEW)]).nativeElement;

    const img = el.querySelector<HTMLImageElement>('[data-test="thumb"]')!;
    expect(img.getAttribute('src')).toBe('https://img.example/a.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(el.querySelector('[data-test="summary"]')?.textContent?.trim()).toBe('Korte inleiding');
  });

  it('verbergt afbeelding en inleiding in de compacte weergave en onthoudt die keuze', () => {
    const fixture = openWith([article('a', false, WITH_PREVIEW)]);
    fixture.nativeElement.querySelector('[data-test="view-compact"]').click();
    fixture.detectChanges();
    TestBed.tick();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-test="thumb"]')).toBeNull();
    expect(el.querySelector('[data-test="thumb-placeholder"]')).toBeNull();
    expect(el.querySelector('[data-test="summary"]')).toBeNull();
    expect(localStorage.getItem('trade-app:news.view')).toBe('compact');

    const again: HTMLElement = openWith([article('a', false, WITH_PREVIEW)]).nativeElement;
    expect(again.querySelector('[data-test="thumb"]')).toBeNull();
  });

  it('toont een placeholder zonder afbeelding of als die niet laadt', () => {
    const fixture = openWith([article('a', false), article('b', false, WITH_PREVIEW)]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('[data-test="thumb-placeholder"]').length).toBe(1);

    el.querySelector('[data-test="thumb"]')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el.querySelectorAll('[data-test="thumb-placeholder"]').length).toBe(2);
    expect(el.querySelector('[data-test="thumb"]')).toBeNull();
  });

  it('zet het NIEUW-label in de uitgebreide weergave inline vóór de titel', () => {
    const el: HTMLElement = openWith([article('a', true)]).nativeElement;
    expect(el.querySelector('[data-test="new-label"]')!.closest('.news-body')).not.toBeNull();
  });

  it('laat lange woorden afbreken in de uitgebreide weergave', () => {
    const el: HTMLElement = openWith([article('a', false, { summary: 'x'.repeat(500) })]).nativeElement;
    const body = el.querySelector<HTMLElement>('.news-body')!;
    expect(getComputedStyle(body).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(body).minWidth).toBe('0px');
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless --include src/app/pages/news/news.component.spec.ts`
Expected: FAIL — no `[data-test="thumb"]`, no `view-compact` button.

- [ ] **Step 4: Implement the component** — in `news.component.ts`:

```ts
import { persistedString } from '../../utils/storage';

export type NewsView = 'compact' | 'extended';
const NEWS_VIEWS: readonly NewsView[] = ['compact', 'extended'];
```

Decorator: add `styleUrl: './news.component.scss',`. Class members (after `addError`):

```ts
  /** Compact = de gewone lijst; uitgebreid toont ook afbeelding en inleiding. Per browser onthouden. */
  view = persistedString<NewsView>('news.view', 'extended', NEWS_VIEWS);
  readonly extended = computed(() => this.view() === 'extended');
  /** Artikels waarvan de afbeelding niet laadde: die tonen de placeholder. */
  private brokenImages = signal<ReadonlySet<string>>(new Set());
```

Methods:

```ts
  showImage(a: NewsArticle): boolean {
    return a.image_url != null && !this.brokenImages().has(a.id);
  }

  imageFailed(id: string): void {
    this.brokenImages.update(s => new Set(s).add(id));
  }
```

- [ ] **Step 5: Implement the template** — in `news.component.html`, inside the header's `<div class="d-flex gap-2">`, before the "Volgen" button:

```html
    <div class="btn-group btn-group-sm" role="group" aria-label="Weergave">
      <button
        type="button"
        class="btn btn-outline-secondary"
        title="Compact"
        data-test="view-compact"
        [class.active]="!extended()"
        [attr.aria-pressed]="!extended()"
        (click)="view.set('compact')"
      >
        <i class="bi bi-list"></i><span class="visually-hidden">Compact</span>
      </button>
      <button
        type="button"
        class="btn btn-outline-secondary"
        title="Uitgebreid"
        data-test="view-extended"
        [class.active]="extended()"
        [attr.aria-pressed]="extended()"
        (click)="view.set('extended')"
      >
        <i class="bi bi-card-text"></i><span class="visually-hidden">Uitgebreid</span>
      </button>
    </div>
```

Replace the body of each article `<li>` (the `<div class="d-flex align-items-start gap-2">…</div>`) with:

```html
            <div class="d-flex align-items-start" [class.gap-2]="!extended()" [class.gap-3]="extended()">
              @if (extended()) {
                <a class="news-thumb flex-shrink-0" [href]="a.url" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
                  @if (showImage(a)) {
                    <img
                      [src]="a.image_url"
                      alt=""
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      data-test="thumb"
                      (error)="imageFailed(a.id)"
                    />
                  } @else {
                    <i class="bi bi-newspaper" data-test="thumb-placeholder"></i>
                  }
                </a>
              } @else if (isNew(a)) {
                <span class="badge text-bg-primary mt-1" data-test="new-label">NIEUW</span>
              }
              <div class="flex-grow-1 news-body">
                @if (extended() && isNew(a)) {
                  <span class="badge text-bg-primary me-1 align-text-bottom" data-test="new-label">NIEUW</span>
                }
                <a class="link-light fw-semibold text-decoration-none" [href]="a.url" target="_blank" rel="noopener">
                  {{ a.title }}
                </a>
                @if (extended() && a.summary) {
                  <div class="news-summary small text-body-secondary" [title]="a.summary" data-test="summary">
                    {{ a.summary }}
                  </div>
                }
                <div class="small text-muted">
                  {{ a.publisher ?? 'Onbekende bron' }} ·
                  <span [title]="formatDateTime(a.published_at)">{{ formatRelativeTime(a.published_at) }}</span>
                  @for (t of a.topics; track topicKey(t)) {
                    <button
                      type="button"
                      class="badge rounded-pill text-bg-secondary border-0 ms-1"
                      (click)="filter.set(t)"
                    >
                      {{ t.value }}
                    </button>
                  }
                </div>
              </div>
            </div>
```

(The `small text-muted` block is today's markup, unchanged.)

- [ ] **Step 6: Implement the styles** — create `news.component.scss`:

```scss
// Uitgebreide weergave: vaste thumbnail zodat titels uitgelijnd blijven, ook zonder afbeelding.
.news-thumb {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--bs-border-radius);
  background: var(--bs-secondary-bg);
  color: var(--bs-secondary-color);
  font-size: 1.5rem;
  text-decoration: none;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

// min-width 0: een flex-kind krimpt anders niet onder de breedte van zijn langste woord.
.news-body {
  min-width: 0;
  overflow-wrap: anywhere;
}

.news-summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
```

- [ ] **Step 7: Run to verify pass**

Run: `cd frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless`
Expected: all specs PASS (the existing news specs too: `new-label` still renders once per new article).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app
git commit -m "wip(news): compact/extended view with image and intro"
```

---

### Task 9: Keep article paths out of Sentry

Sentry runs with `tracesSampleRate: 1.0`, so every publisher fetch becomes a span (`url.full`, `url.path`, description `GET https://…`, and a transaction named after it when no request is active) plus a fetch breadcrumb (`data.url`). `electron/scrub.ts` already cuts query strings; the **path** of an article URL (`/markten/kbc-hoofdeconoom-…`) still reveals what the user follows. Rule: API hosts keep their path (it tells which provider call broke); every other host keeps only its origin.

**Files:**
- Modify: `electron/scrub.ts`
- Modify: `electron/sentry.ts` (`beforeSendTransaction`)

**Interfaces:**
- Produces: `export function isApiHost(host: string): boolean`, `export function scrubUrl(value: string): string`; `scrubBreadcrumb` and `scrubSpanData` use them.

`electron/` has no test runner (see the header of `scrub.ts`), so verification is a throwaway Node script, not a committed test.

- [ ] **Step 1: Write the verification script first** — create `$SCRATCH/scrub-check.ts` (any scratch directory outside the repo; replace `<worktree>` with the absolute worktree path):

```ts
import assert from "node:assert/strict";
import { scrubBreadcrumb, scrubSpanData, scrubUrl } from "<worktree>/electron/scrub";

// Article pages: origin only.
assert.equal(scrubUrl("https://www.tijd.be/markten/kbc-hoofdeconoom.html"), "https://www.tijd.be/<redacted>");
assert.equal(scrubUrl("GET https://www.tijd.be/markten/kbc.html?x=1"), "GET https://www.tijd.be/<redacted>");
assert.equal(scrubUrl("https://finance.yahoo.com/news/kbc-q3-results-050000023.html"), "https://finance.yahoo.com/<redacted>");
assert.equal(scrubUrl("https://www.tijd.be/"), "https://www.tijd.be/");
// API hosts: path kept, query cut (unchanged behavior).
assert.equal(scrubUrl("https://query2.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d"), "https://query2.finance.yahoo.com/v8/finance/chart/AAPL?<redacted>");
assert.equal(scrubUrl("https://news.google.com/rss/search?q=ECB"), "https://news.google.com/rss/search?<redacted>");
assert.equal(scrubUrl("https://api.frankfurter.dev/v1/2026-10-15?base=USD"), "https://api.frankfurter.dev/v1/2026-10-15?<redacted>");
// Not a URL: just stripQuery.
assert.equal(scrubUrl("SELECT * FROM t WHERE a = ?"), "SELECT * FROM t WHERE a = ?<redacted>");

const crumb = { data: { url: "https://www.hln.be/geld/kbc-artikel.html", method: "GET" } };
scrubBreadcrumb(crumb);
assert.equal(crumb.data.url, "https://www.hln.be/<redacted>");

const span: Record<string, unknown> = {
  "url.full": "https://www.tijd.be/markten/kbc.html",
  "url.path": "/markten/kbc.html",
  "http.target": "/markten/kbc.html",
  "server.address": "www.tijd.be",
};
scrubSpanData(span);
assert.deepEqual(span, {
  "url.full": "https://www.tijd.be/<redacted>",
  "url.path": "/<redacted>",
  "http.target": "/<redacted>",
  "server.address": "www.tijd.be",
});

const apiSpan: Record<string, unknown> = { "url.path": "/v8/finance/chart/AAPL", "server.address": "query1.finance.yahoo.com" };
scrubSpanData(apiSpan);
assert.equal(apiSpan["url.path"], "/v8/finance/chart/AAPL");

console.log("scrub ok");
```

- [ ] **Step 2: Run to verify failure**

Run: `backend/node_modules/.bin/tsx $SCRATCH/scrub-check.ts`
Expected: FAIL — `scrubUrl` is not exported.

- [ ] **Step 3: Implement** — in `electron/scrub.ts`, after `stripQuery`:

```ts
/** Hosts whose URL paths are API endpoints: keep them, they say which provider call broke. */
const API_HOSTS =
  /(?:^|\.)(?:query[12]\.finance\.yahoo\.com|fc\.yahoo\.com|guce\.yahoo\.com|consent\.yahoo\.com|frankfurter\.dev|frankfurter\.app|news\.google\.com)$/i;

export function isApiHost(host: string): boolean {
  return API_HOSTS.test(host);
}

/**
 * stripQuery, and on any other host — a publisher's article page — only the origin stays: a
 * slug like `/markten/kbc-hoofdeconoom-…` reveals what the user follows. Works on a bare URL
 * and on a span description (`GET https://…`); a string without a URL just loses its query.
 */
export function scrubUrl(value: string): string {
  const cut = value.replace(/(https?:\/\/[^/\s?#]+)(\S*)/gi, (whole, origin: string, rest: string) => {
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      return whole;
    }
    return isApiHost(host) || rest === '' || rest === '/' ? whole : `${origin}/<redacted>`;
  });
  return stripQuery(cut);
}
```

In `scrubBreadcrumb`, replace `stripQuery(data[key] as string)` with `scrubUrl(data[key] as string)`.

Replace `scrubSpanData` with:

```ts
/** Span data keys holding only a path: redacted outright when the span's host is a publisher. */
const SPAN_PATH_KEYS = ['url.path', 'http.target'];

/**
 * Scrub the span data of a transaction/span in place: URL-like values lose their query (and,
 * off the API hosts, their path), and query-valued keys are removed.
 */
export function scrubSpanData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const host = typeof data['server.address'] === 'string' ? (data['server.address'] as string) : null;
  for (const key of SENSITIVE_SPAN_DATA) {
    if (typeof data[key] !== 'string') continue;
    if (SPAN_PATH_KEYS.includes(key) && host != null && !isApiHost(host)) data[key] = '/<redacted>';
    else data[key] = scrubUrl(data[key] as string);
  }
  for (const key of QUERY_VALUE_KEYS) delete data[key];
}
```

In `electron/sentry.ts` `beforeSendTransaction`: change the span description line to `span.description = scrubUrl(span.description)`, add before the spans loop

```ts
      // A fetch outside any request is its own root span, named `GET https://…`.
      if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction);
```

and add `scrubUrl` to the import from `./scrub` (drop `stripQuery` from that import if nothing in `sentry.ts` uses it any more).

- [ ] **Step 4: Run to verify pass**

Run: `backend/node_modules/.bin/tsx $SCRATCH/scrub-check.ts && npx tsc -p electron/tsconfig.json --noEmit`
Expected: `scrub ok`, no type errors.

- [ ] **Step 5: Commit**

```bash
git add electron/scrub.ts electron/sentry.ts
git commit -m "wip(news): keep article paths out of sentry"
```

---

### Task 10: Documentation + end-to-end check

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above. Produces: docs only.

- [ ] **Step 1: Update CLAUDE.md** —
  - File structure, `services/` list: after the `googleNews.ts` line add
    `      (googleNews also decodes a news.google.com link to the publisher URL — unofficial batchexecute RPC)`
    and after `newsService.ts` add
    ```
    articlePreview.ts    — one article page → og:image / og:description (head only; http(s) + SSRF guard; 5 s, 512 KB; consent walls = none)
    newsPreviews.ts      — enrichment step: pending previews once per article, 4 at a time, Google decode + circuit breaker, providerHealth (google.decode, yahoo.article)
    ```
  - `pages/news/` line: append `; compact/uitgebreid toggle (thumbnail + inleiding)`.
  - DB schema: change the `news_articles` line to
    `- **news_articles**: id (Yahoo uuid / Google guid), title, publisher, url (Google: decoded publisher URL once previewed), published_at, source, image_url, summary, preview_at (NULL = preview still to try), fetched_at (first sighting)`
    and `schema_version` to `(current: 6)`.
  - News section: before "**Retention 30 days**" add:
    ```
    - **Previews** (`newsPreviews.ts`, `articlePreview.ts`): Yahoo's search thumbnail is stored at
      ingest; after each round (max 50) and each follow (max 20) every unsettled article's page is
      read once for `og:image` / `og:description` — never the body. Google links go through an
      **unofficial** decode (article page signature → `batchexecute` RPC); it has broken before, so
      failures stay pending, trip a breaker after 3 in a row and escalate via `google.decode`.
      `ok`/`none` set `preview_at`; network/5xx/429 leave it NULL for the next round. Images are
      **hot-linked** (`referrerpolicy="no-referrer"`, no proxy/cache — publishers' CDNs see the IP,
      as when opening the article). Log lines carry host + reason only.
    ```
  - Observability section, "**Privacy = cloud + scrub**" bullet: append "Breadcrumb/span URLs keep their path only on API hosts (`isApiHost` in `electron/scrub.ts`); any other host (a publisher's article page) is cut to its origin, since an article slug reveals what the user follows."
  - Known limitations: replace "News has no AI summary or subject clustering yet" with "News has no AI summary or subject clustering yet; some publishers (e.g. Mediahuis titles) refuse preview requests (403), so their articles show without image/intro."

- [ ] **Step 2: Full verification**

```bash
cd backend && npx vitest run && npx tsc --noEmit
cd ../frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless
cd .. && npm run check:deps
```

Expected: all green.

- [ ] **Step 3: Live smoke test (real network, throwaway db)** — start the backend on a spare port with a scratch database, follow one keyword and one ticker, and inspect the stored previews:

```bash
cd backend && DB_PATH=/tmp/claude-smoke/news.db PORT=3199 npx tsx src/index.ts
```

(in another shell)

```bash
curl -s -X POST localhost:3199/api/news/topics -H 'content-type: application/json' -d '{"kind":"KEYWORD","value":"KBC"}' > /dev/null
curl -s -X POST localhost:3199/api/news/topics -H 'content-type: application/json' -d '{"kind":"TICKER","value":"AAPL"}' > /dev/null
curl -s localhost:3199/api/news | node -e 'const r=JSON.parse(require("fs").readFileSync(0));const by=s=>r.articles.filter(a=>a.source===s);for(const s of ["yahoo","google"]){const a=by(s);console.log(s,a.length,"img",a.filter(x=>x.image_url).length,"intro",a.filter(x=>x.summary).length,"direct",a.filter(x=>!x.url.includes("news.google.com")).length)}'
```

Expected: most Yahoo articles have `img` and `intro`; most Google articles have `direct` URLs and many have `img`/`intro` (a minority 403s is fine). Stop the server and delete the scratch db afterwards. If Google shows 0 `direct`, the decode broke — check `/api/diagnostics` counters (`google.decode`) and the debug lines before shipping.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "wip(news): document article previews"
```
