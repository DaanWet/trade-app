# Design: News tab — issue #11

**Date:** 2026-10-15
**Issue:** [#11 "New feature: News"](https://github.com/DaanWet/trade-app/issues/11)

## Problem

A user asked for a "Nieuws" tab showing articles relevant to their stocks, and optionally to
keywords they choose themselves. The app should look for new articles on its own and show or link
them. Ideally an agent would filter them, write a short summary and merge several articles about
the same subject.

## Decisions (from brainstorming)

- **No AI in this version.** Filtering and grouping are rule-based. The AI layer (summary,
  clustering by subject) may come later; storing articles in the db is the seam it would build on
  (see "Later: AI layer").
- **What is followed:** open positions (automatic) ∪ watchlist tickers ∪ free keywords. Closed
  positions are not followed unless the ticker is on the watchlist.
- **"New":** the app fetches in the background, shows a count badge in the navbar, marks new
  articles with a `NIEUW` label and has a refresh button.
- **Layout:** one timeline (newest first) with filter chips per topic. An article about several
  followed topics appears once with several badges.
- **Approach A:** the backend fetches and stores everything. Background refresh is driven by the
  badge poll (staleness check), so the backend has no timer of its own.
- **Not clustering by subject.** Without AI that is unreliable. Deduplication only: the same
  article for several topics → one row with several badges; identical titles within one query
  collapse.

## Findings from exploration (2026-10-15)

- `yahoo.search(q, { newsCount })` returns `uuid, title, publisher, link, providerPublishTime,
  relatedTickers`, with **no article body**.
- **Searching by symbol alone is unreliable.** `KBC.BR` → 0 items; `KBC Group` → 4 items, all
  tagged `relatedTickers: [KBC.BR]`. `CAS` (an ETF) → 8 items about unrelated "CAS" companies, none
  tagged `CAS`. Querying by symbol **and** name and keeping only items whose `relatedTickers`
  contains the symbol fixes both.
- `HYPG`, `ZAR=X` → no news. That's fine: those topics just stay empty.
- **Yahoo is weak for free keywords** (`Nvidia earnings` → weeks-old items). **Google News RSS**
  (`news.google.com/rss/search?q=<kw> when:7d&hl=nl&gl=BE&ceid=BE:nl`) works well: `ECB rente` → 37
  items from De Tijd, De Morgen, Trends, Belga… Each item has `title` (suffixed with
  ` - <source>`), `link` (a news.google.com redirect), `guid`, `pubDate`, `source`. There is no body
  either. Node's default `fetch` User-Agent is accepted (verified: 200, 38 items).

## Data model — migration 5

```sql
CREATE TABLE news_topics (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('TICKER','KEYWORD')),
  value       TEXT NOT NULL COLLATE NOCASE,   -- "ECB rente" = "ecb rente"
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, value)
);

CREATE TABLE news_articles (
  id            TEXT PRIMARY KEY,          -- Yahoo uuid or Google guid
  title         TEXT NOT NULL,
  publisher     TEXT,
  url           TEXT NOT NULL,
  published_at  TEXT NOT NULL,             -- ISO 8601 UTC
  source        TEXT NOT NULL CHECK (source IN ('yahoo','google')),
  fetched_at    TEXT NOT NULL              -- first time we saw it; never updated
);

CREATE TABLE news_article_topics (
  article_id  TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (article_id, kind, value)
);
```

- `news_topics` holds only what the user added (watchlist + keywords). Open positions are derived
  from `trades` and never stored.
- **`news_article_topics` has a composite primary key, not a surrogate id.** Nothing references a
  single link row. The PK enforces the one invariant needed (an article gets each badge once, even
  though it comes in via the symbol and name queries and again every refresh), so
  `INSERT OR IGNORE` is idempotent. A surrogate id would still need the same `UNIQUE` → two
  indexes, one unused column. This is the same pattern as `fx_rates` / `daily_prices`.
- Badges are stored as `kind + value`, not as an FK to `news_topics`, because position topics have
  no row there.
- New setting `SETTING_KEYS.NEWS_LAST_SEEN = 'news_last_seen'` (ISO timestamp; absent = epoch, so
  everything counts as new on first use). It is not added to diagnostics' `SAFE_SETTING_KEYS`.
- The last refresh time lives **in memory only**. Every app start is therefore stale and fetches
  straight away.

### "New" semantics

- An article is new when `fetched_at > news_last_seen`.
- The badge count is the number of distinct new articles linked to a **currently followed** topic.
- `fetched_at` is used rather than `published_at` so an article that Yahoo indexes late still
  counts. Adding a keyword makes its articles new, which is correct because the user hasn't seen
  them.

### Retention and visibility

- Items with `published_at` older than **30 days** are skipped at ingest. They are not inserted,
  so they cannot be inserted, pruned and re-inserted as "new" every round; Yahoo's name search does
  return months-old items.
- Each refresh ends with `DELETE FROM news_articles WHERE published_at < now − 30 days`. Links go
  with them via the cascade (foreign keys are ON in `db.ts`).
- The list and the count only include articles with at least one link to a currently followed
  topic. Unfollowing a topic hides its articles immediately; no cascade from `news_topics` is
  needed.

## Backend

### Providers — `services/providers/`

Shared DTO in `types.ts`:

```ts
interface NewsItem {
  id: string; title: string; publisher: string | null; url: string;
  published_at: string; source: "yahoo" | "google";
}
```

**`yahooNews.ts` → `fetchTickerNews(symbol: string, name: string | null): Promise<NewsItem[]>`**

- Runs `yahoo.search(symbol, { quotesCount: 0, newsCount: 10 })`, plus the same with
  `cleanCompanyName(name)` when a name is known and differs from the symbol. It uses the shared
  `yahooClient`.
- `cleanCompanyName` strips trailing legal-form tokens and punctuation, e.g.
  `KBC Group NV` → `KBC Group`, `Advanced Micro Devices, Inc.` → `Advanced Micro Devices`,
  `KB Components AB (publ)` → `KB Components`. Suffix set: `NV, N.V., SA, S.A., AG, SE, ASA, AB,
  (publ), plc, Inc, Inc., Corp, Corp., Corporation, Co., Ltd, Ltd., Limited`.
- **Relevance rule:** keep an item only if `relatedTickers` contains `symbol` (exact,
  case-insensitive).
- Deduplicates on `uuid`. Throws if every query threw, so the service can count the failure.

**`googleNews.ts` → `fetchKeywordNews(keyword: string): Promise<NewsItem[]>`**

- Calls `GET https://news.google.com/rss/search?q=<encodeURIComponent(keyword + " when:7d")>&hl=nl&gl=BE&ceid=BE:nl`
  with Node's default `fetch`.
- Parses the response with **`fast-xml-parser`**, a new dependency (pure JS, no deps). It goes in
  **both** root and backend `package.json` at the same version (dependency parity,
  `npm run check:deps`).
- `id = guid`, `publisher = <source>`, and `title` has the trailing ` - <source>` removed. Items
  whose normalized title (lowercased, whitespace collapsed) repeats are collapsed to the earliest.
  At most 20 items are kept. A non-2xx response or a parse failure throws.

### Orchestration — `services/newsService.ts`

| function | behaviour |
| --- | --- |
| `followedTopics()` | open positions (DB-only, via a new `openTickers()` helper in `positionsCalc.ts` built on `walkTrades`) ∪ `news_topics`; deduped; each with `origin` and the `news_topics.id` when present |
| `refreshNews()` | single-flight: a module-level in-flight promise, so a second caller gets the same promise. Topics are processed **sequentially** to be gentle with Yahoo. Ticker names come from the `tickers` cache. Then `INSERT OR IGNORE` articles and links, prune, and record `lastRefreshAt` plus `failedTopics` |
| `refreshTopic(topic)` | the same for one topic; used right after adding one |
| `maybeRefresh()` | fire-and-forget `refreshNews()` when the last refresh is older than **30 min**, or **5 min** if the last round failed for *every* topic. Never awaited by callers |
| `getStatus()` | `{ last_refresh_at, refreshing, failed_topics }` |

- Time comes from an injectable `now()` (default `Date.now`) so tests can drive the thresholds.
- Constants go in `helpers/constants.ts`: `NEWS_REFRESH_INTERVAL_MS` (30 min),
  `NEWS_RETRY_AFTER_FAILURE_MS` (5 min), `NEWS_RETENTION_DAYS` (30).

### Error handling

- Each topic has its own try/catch, so one failing topic never stops the others.
- Failures go to `logger.warn("news", …)` and `providerHealth.recordFailure("yahoo" | "google",
  "news", msg)`, and successes to `recordSuccess`. The existing escalation (3 in a row →
  `logger.error` → Sentry) and `/api/diagnostics` counters therefore cover news without extra
  code.
- Log messages name ticker topics by symbol (already redacted remotely by `scrubText`) and keyword
  topics by `keyword #<id>`, never by their text. Keywords reveal interests and should not leave
  the machine.
- **Offline:** stored articles stay visible, the status shows the failed topics, and the 5-minute
  retry applies.
- A topic with zero results is not a failure.

### API — `routes/news.ts` (mounted at `/api/news`, the 8th router)

| endpoint | behaviour | response |
| --- | --- | --- |
| `GET /api/news` | articles for followed topics within retention, newest first | `{ articles: NewsArticle[], topics: NewsTopic[], status: NewsStatus, as_of: string }` |
| `GET /api/news/unread` | calls `maybeRefresh()`, then counts | `{ count: number, refreshing: boolean }` |
| `POST /api/news/seen` `{ seen_at }` | sets `news_last_seen = seen_at` (zod: ISO datetime, not in the future) | 204 |
| `POST /api/news/refresh` | awaits `refreshNews()` (joins one in flight) | same as `GET /api/news` |
| `POST /api/news/topics` `{ kind, value }` | validates and inserts. For `TICKER` it first runs `fetchQuote(symbol)` (cache-first) so `tickers.name` exists, then awaits `refreshTopic`. A fetch failure does **not** fail the request | 201 `{ topic: NewsTopic }`; 400 invalid; 409 duplicate |
| `DELETE /api/news/topics/:id` | deletes the row | 204; 404 if missing |

- `NewsArticle = { id, title, publisher, url, published_at, source, topics: { kind, value }[],
  is_new }`. `topics` only contains currently followed topics. `is_new` is computed against the
  stored `news_last_seen`.
- `NewsTopic = { id: number | null, kind, value, origin: "POSITION" | "WATCHLIST" | "KEYWORD" }`.
  A ticker that is both an open position and on the watchlist appears once with origin `POSITION`
  (and its watchlist `id`). The watchlist entry takes over when the position is sold. `topics`
  includes topics with zero articles, so every chip exists.
- **`seen_at` echoes the server's `as_of`, not "now".** An article that arrives between the GET
  and the POST must not be marked seen unseen. The marker **never moves backwards**: a late, older
  `seen_at` is accepted (204) but ignored, so it cannot bring back old "new" labels.
- Validation: `TICKER` is uppercased and must match `^[A-Z0-9.^=\-]{1,20}$`; `KEYWORD` is trimmed
  and must be 2–60 characters. Duplicates are matched case-insensitively (409).
- A watchlist ticker may also be an open position; this is allowed on purpose.

## Frontend

### Navbar badge

- `app.component.html` gets a new item "Nieuws" (`bi-newspaper`, route `/news`) between Belasting
  and Instellingen. When the count is above 0 it shows `<span class="badge rounded-pill bg-danger">`,
  capped at `99+`.
- `services/news-badge.service.ts` (`providedIn: 'root'`) holds `unread = signal(0)`. It runs
  `timer(0, 120_000)` → `switchMap(() => api.getNewsUnread().pipe(catchError(() => EMPTY)))`. The
  error is caught **inside** the `switchMap`, otherwise one failed request kills the polling for
  good. It also has `clear()`. `AppComponent` injects it so it runs on every page.

### Page — `pages/news/` (lazy route `/news`)

- **Chips row:** `[Alles]` plus one chip per topic with its article count. The origin icon is
  `bi-briefcase` for a position, `bi-eye` for watchlist and `bi-search` for a keyword. Watchlist
  and keyword chips get an `×` that deletes without a confirm modal (cheap to redo). On the right
  are "+ Volgen" and the refresh button (spinner while `POST /refresh` runs).
- **Status line:** "Laatst bijgewerkt: <datum uur>", "Bezig met ophalen…" while refreshing, and a
  warning alert listing `failed_topics` when that list is non-empty.
- **Timeline:** each row shows an optional `NIEUW` badge, the title as
  `<a target="_blank" rel="noopener">`, then "publisher · 2 u geleden" and the topic badges.
  Clicking a badge sets the filter. Electron's existing `setWindowOpenHandler` already opens these
  links in the system browser.
- **Visit flow:**
  1. `GET /api/news` on open.
  2. `POST /seen { seen_at: as_of }` and `badge.clear()`.
  3. The labels stay until the user leaves the page. The page keeps a visit-scoped set of the
     ids that were new, so a refresh (whose payload no longer flags them) doesn't drop their labels.
  4. After a refresh, the same is done with the new `as_of`.
  5. If the payload says a background round is running (e.g. right after app start), the page
     joins it via `POST /refresh` instead of showing a list that never updates.
- **"+ Volgen"** opens an inline form with a Ticker | Trefwoord toggle. Ticker uses a new
  `shared/ticker-search/` autocomplete component (`/api/prices/search`). The trade-form keeps its
  built-in autocomplete; it is **not** refactored here. After adding, the page reloads, which marks
  it seen and clears the badge.
- **Empty states:**
  - no topics at all → explanation plus a "+ Volgen" button;
  - topics but no articles yet;
  - the active filter matches nothing.
- The chip filter is **not** persisted (unlike the chart's ticker filter): opening the news tab
  should show everything.

### Helpers

- `utils/news-filter.ts` holds pure functions: `filterArticles(articles, topic | null)` and
  `chipCounts(articles, topics)`.
- `utils/format.ts` gets `formatRelativeTime(iso, now?)`. It uses `Intl.RelativeTimeFormat('nl-BE')`
  ("2 u geleden", "gisteren") and falls back to `formatDate` after 7 days.
- `models/index.ts` gets `NewsArticle`, `NewsTopic`, `NewsStatus`, `NewsResponse`.
- `api.service.ts` gets `getNews`, `getNewsUnread`, `markNewsSeen`, `refreshNews`, `addNewsTopic`
  and `deleteNewsTopic`.

## Testing

No test touches the network. `yahooClient` is mocked with `vi.mock` (as in `yahooPrice.test.ts`),
and `fetch` returns an RSS fixture captured from a real response.

**Backend (vitest)**

- `yahooNews.test.ts`:
  - the relevance rule drops untagged items (the CAS case);
  - symbol and name results are merged and deduped on uuid;
  - `cleanCompanyName` cases;
  - with no name, only the symbol query runs;
  - it throws only when all queries throw.
- `googleNews.test.ts`:
  - fixture parsing (entities, attributes ignored);
  - the ` - source` suffix is stripped;
  - identical titles collapse;
  - the 20-item cap;
  - the URL carries `when:7d` and `hl=nl&gl=BE`;
  - a non-2xx response throws.
- `newsService.test.ts`:
  - the `followedTopics` union: a sold-out position drops out, overlap appears once with origin
    POSITION;
  - a second refresh adds no duplicate links and leaves `fetched_at` unchanged;
  - one failing topic doesn't stop the others and lands in `failed_topics`;
  - concurrent calls cause one provider round;
  - the 30-minute and 5-minute thresholds via the injected clock;
  - items older than 30 days are skipped at ingest, and the prune cascades to links.
- `routes/news.test.ts`:
  - response shapes;
  - `is_new` against `news_last_seen`;
  - `seen_at` is respected;
  - the unread count;
  - validation: 400 for a bad symbol or short keyword, 409 for a duplicate, 404 on delete;
  - unfollowing hides articles.

**Frontend (Karma)**

- `news-filter.spec.ts`.
- `formatRelativeTime` spec.
- `news-badge.service` keeps polling after an HTTP error (`HttpTestingController` +
  `fakeAsync`).
- `news.component`: `seen_at` echoes `as_of`; labels survive a refresh; it joins a running round.

**Manual check in the running app**

- adding a keyword → articles appear immediately;
- the badge counts up → opening the tab shows labels and sets the badge to 0;
- the refresh button;
- a watchlist ticker with no news;
- the failed-topic warning, by blocking the network.

## Documentation

`CLAUDE.md` gets:

- a "News" section under Core domain logic (sources, relevance rule, "new" semantics, refresh
  model);
- the new endpoints, files and tables, with `schema_version` raised to 5.

The "News agent … not yet implemented" line is replaced by the note under "Later: AI layer".

## Out of scope

- AI summaries or clustering by subject.
- Fetching article bodies. (Previews read only the page's `<head>` meta tags; see the addendum.)
- Per-article read state.
- Muting an open position's news.
- Persisting the chip filter.
- OS notifications.
- Refactoring the trade-form onto `ticker-search`.

## Later: AI layer

Articles and their topics are in the db, so a later summarizer can read
`news_articles ⋈ news_article_topics` after `refreshNews()`, cluster by subject and write a digest
row next to them, without changing the fetch pipeline. Article bodies are not available, but most
articles carry the publisher's own preview text (`summary`, see the addendum), which gives a
summarizer more than the title to work from. The API key
question (per-user key vs. bundled) is open and was deferred deliberately.

---

# Addendum (2026-10-16): article previews — image + intro, compact/extended toggle

## Problem

The timeline shows a title, publisher and time per article. A small image and a short intro make
it much faster to judge whether an article is worth opening. Not everyone wants the denser
layout, so the page gets a toggle: **compact** (today's list) and **extended** (image + intro).

## Decisions (from brainstorming)

- **Enrich everything**: ticker news (Yahoo) and keyword news (Google) both get an image and an
  intro where the publisher provides them.
- **Separate enrichment step**, once per article, stored in the db. Not inside the providers (that
  would re-fetch known articles every round) and not on demand from the page (many requests at
  view time, images popping in late).
- The intro is the publisher's own preview text (`og:description`), never the article body.
- A failed enrichment never breaks anything: the article just renders as it does today.
- The decoded Google link replaces the stored `url`, so a click goes straight to the publisher.
- Images are hot-linked from the publishers' CDNs; no backend image proxy or cache (YAGNI for a
  single-user local app).
- The toggle defaults to **extended** and is remembered in localStorage.

## Findings (spike, 2026-10-16)

| source | image | intro |
| --- | --- | --- |
| Yahoo search (`news[]`) | `thumbnail.resolutions[]` on nearly every item, incl. a ready-made `140x140` crop. No extra request. | Not in the search result. The `finance.yahoo.com` article page has `og:description` (3/3 tested, no consent wall from a BE connection). |
| Google News RSS | None (no `media:*` elements). | None: `<description>` repeats the title + source as HTML. |

- A Google `link` (`news.google.com/rss/articles/<guid>`) lands on a generic Google page whose
  `og:*` tags describe Google News itself. The real URL comes from an **unofficial** two-step
  decode: the article page carries `data-n-a-sg` (signature) and `data-n-a-ts` (timestamp), and a
  POST to `https://news.google.com/_/DotsSplashUi/data/batchexecute` (rpc `Fbv4je`,
  `garturlreq`) answers `garturlres` with the publisher URL. This scheme has broken before when
  Google changed it.
- Publisher pages after decoding: 5/6 gave an image and an intro (De Tijd, Bloovi, MarketScreener,
  Evoke PR, De Aandeelhouder). Nieuwsblad answered 403 (Mediahuis bot protection). Some intros are
  boilerplate that only repeats the title (Bloovi: `Lees "<title>" op Bloovi.`).
- There is no Content-Security-Policy, so external images load in Electron as-is.

## Data model — migration 6

```sql
ALTER TABLE news_articles ADD COLUMN image_url  TEXT;  -- http(s) only; NULL = none
ALTER TABLE news_articles ADD COLUMN summary    TEXT;  -- publisher preview text, ≤ 300 chars
ALTER TABLE news_articles ADD COLUMN preview_at TEXT;  -- ISO 8601 UTC; NULL = still to try
```

A new migration rather than editing migration 5: dev databases already have v5. Existing rows
start with `preview_at NULL` and are backfilled by the next rounds like any new article.
`schema_version` current becomes 6.

## Backend

### Thumbnail at ingest — `providers/yahooNews.ts`

`NewsItem` gains `image_url: string | null`. `pickThumbnail(resolutions)` chooses, in order: the
resolution tagged `140x140`; else the smallest one with `width ≥ 100`; else the first; else
`null`. Only `http(s)` URLs count. Google items get `image_url: null`. `saveArticles` stores it
(the insert stays `INSERT OR IGNORE`, so rows that already exist keep their values).

### Google link decode — `providers/googleNews.ts`

`resolveGoogleNewsUrl(guid): Promise<string>` does the two-step decode above and throws when a
step fails (no signature/timestamp on the page, non-2xx, response without `garturlres`).

### Preview extraction — `services/articlePreview.ts`

- `extractPreview(html, title, baseUrl): { image_url, summary }` — pure.
  - Scans `<meta>` tags up to `</head>` (or the whole input when there is none); attributes may
    come in any order (`content` before `property` is common).
  - Text: `og:description` → `twitter:description` → `description`.
    Image: `og:image` → `twitter:image`.
  - Decodes HTML entities (named basics plus `&#NN;` / `&#xNN;`), collapses whitespace.
  - Resolves a relative image URL against `baseUrl`; drops anything that isn't `http(s)`.
  - Drops the intro when its normalized form (lowercase, single spaces) **contains** the
    normalized title.
  - Truncates the intro to 300 characters at the last word boundary (a hard cut when the first
    300 characters hold no space), appending `…`.
- `isAllowedUrl(url)`: `http(s)` only, and not `localhost`, `*.localhost`, or an IP literal in a
  loopback / private / link-local range. A cheap SSRF guard for URLs that come from third parties.
- `fetchPreview(url, title): Promise<PreviewOutcome>` where the outcome is one of
  - `{ kind: 'ok', image_url, summary }` — a 2xx `text/html` page (either field may be `null`);
  - `{ kind: 'none', reason }` — definitive: a 4xx, a non-HTML content type, or a URL that
    `isAllowedUrl` rejects;
  - `{ kind: 'retry', reason }` — transient: network error, timeout, 5xx, 429.
  - Request: link-preview `User-Agent` (`trade-app-linkpreview/1.0`, Ruling 10 — a browser UA makes
    Yahoo answer with a header over undici's 16 KB limit; Google's decode keeps the browser UA),
    `Accept: text/html`, `Accept-Language: nl-BE,nl;q=0.9,en;q=0.8`,
    redirects followed, `AbortSignal.timeout(5000)`. The body is read as a stream and abandoned
    after 512 KB; decoded with the charset from `Content-Type`, defaulting to UTF-8.

### Enrichment — `services/newsPreviews.ts`

`enrichPending({ topic?, limit }): Promise<void>` loads articles with `preview_at IS NULL` and
`published_at ≥ retention cutoff`, newest first, optionally restricted to one topic, at most
`limit`. It processes them **4 at a time**:

- **Yahoo**: `fetchPreview(url, title)`. On `ok`, the stored Yahoo thumbnail wins over the page's
  `og:image`; the page image only fills a `NULL`.
- **Google**: `resolveGoogleNewsUrl(guid)` first.
  - Decode failed → `retry` (and counts toward the circuit breaker).
  - Decoded URL rejected by `isAllowedUrl` → `none`, the Google URL stays.
  - Otherwise the decoded URL is stored as `url` at once (even if the publisher fetch then
    fails), then `fetchPreview` on it.
- Outcome handling: `ok` and `none` set `preview_at = now` (`ok` also writes the fields);
  `retry` leaves `preview_at NULL`, so the next round tries again. Retries are bounded by the
  30-day retention.
- **Circuit breaker**: 3 consecutive decode failures (in completion order) within one call skip the remaining Google
  articles of that call (they stay `NULL`), so a broken decode doesn't hammer Google.

Call sites in `newsService.ts`:

- `runRefresh()`: after ingesting all topics, before pruning — `enrichPending({ limit: 50 })`.
  Anything beyond 50 waits for the next round. `status.refreshing` stays `true` until enrichment
  is done, so the page's existing "refreshing → reload when done" flow picks up the images.
- `refreshTopic(topic)` (a new follow): `enrichPending({ topic, limit: 20 })` after the ingest.
  Following a keyword therefore takes a few seconds longer.

### Error handling and observability

- Enrichment never fails a round: every article is wrapped; `failed_topics` and the "new"
  semantics are about fetching news only.
- `providerHealth` tracks only what can break systematically:
  - `google` / `decode` — failure per failed decode, success per decoded URL.
  - `yahoo` / `article` — for article URLs on a `yahoo.com` host: an outcome without a summary
    counts as a failure (a consent wall answers 200 without the article's tags), a summary as a
    success.
  - Publisher pages are **not** tracked: a 403 from one site is expected variance, like the
    Frankfurter 404s.
- Logging: per article at **debug**, host + status/reason only (`preview: www.nieuwsblad.be →
  403`). Never the full URL or the title: both can reveal a keyword, and log lines become Sentry
  breadcrumbs. One **info** line per call that processed anything, counts only
  (`previews: 12 ok, 3 none, 2 retry`).

### API

`NewsArticle` gains `image_url: string | null` and `summary: string | null`
(`listArticlesFor` selects them). No new routes, no other contract changes.

## Frontend

### Toggle — `pages/news/`

- A small button group in the header, next to "Volgen" and ⟳: two icon buttons, `bi-list`
  (Compact) and `bi-card-text` (Uitgebreid), with `title` and `aria-pressed`.
- State: `persistedString<'compact' | 'extended'>('news.view', 'extended', ['compact', 'extended'])`
  from `utils/storage.ts`.
- The toggle only changes the rendering; filters, counts and NIEUW labels are unaffected.

### Compact

Exactly today's list.

### Extended

```
┌──────┐  [NIEUW] Article title (link)
│ img  │  Intro in small muted text, at most two lines,
│ 64px │  then clamped with…
└──────┘  De Tijd · 2 u geleden · (KBC)
```

- Thumbnail: 64×64, rounded, `object-fit: cover`, `loading="lazy"`, `referrerpolicy="no-referrer"`
  (sidesteps Referer-based hot-link blocks and leaks less). Wrapped in the same link as the title.
- No image, or the image fails to load (`(error)` adds the article id to a signal-held set): a
  placeholder of the same size with a `bi-newspaper` icon, so titles stay aligned. Articles not
  enriched yet look the same until the round finishes and the page reloads.
- Intro: below the title, `-webkit-line-clamp: 2`, full text in the `title` attribute; rendered by
  interpolation only, never `innerHTML`. No intro → no empty space.
- The NIEUW label sits inline before the title instead of as its own column.

### Model

`NewsArticle` (`models/index.ts`) gains `image_url: string | null` and `summary: string | null`.

## Privacy

- In extended mode the publishers' CDNs see the user's IP when the news page is open, as they
  would when an article is opened. `no-referrer` limits what else leaks. Documented in CLAUDE.md
  as a deliberate choice.
- The backend's preview requests reveal the IP to publishers the same way.
- Known risk: the `batchexecute` decode is unofficial and may break at any time; the escalation
  makes that visible, and articles fall back to today's rendering.

## Testing

Backend (vitest):

- `extractPreview`: priority og → twitter → description; attribute order; entities (`&quot;`,
  `&#39;`, `&#x27;`, `&amp;`); relative image URL resolved; non-`http(s)` image dropped; intro
  containing the title dropped; truncation at a word boundary with `…`; input without `<head>`.
- `isAllowedUrl`: http/https allowed; `ftp:`, `javascript:`, `localhost`, `127.0.0.1`, `10.x`,
  `192.168.x`, `[::1]` rejected.
- `fetchPreview` (mocked `fetch`): 2xx HTML → `ok`; 403 → `none`; non-HTML → `none`; 503 / 429 /
  network error / timeout → `retry`; body cut at 512 KB.
- `pickThumbnail`: `140x140` preferred, smallest ≥ 100 px fallback, first as last resort, none →
  `null`, non-`http(s)` skipped.
- `resolveGoogleNewsUrl` (mocked `fetch`): happy path; page without signature → throws; malformed
  `batchexecute` response → throws.
- `enrichPending` (mocked fetchers, in-memory db): `ok` / `none` / `retry` outcomes and
  `preview_at`; Yahoo thumbnail not overwritten by `og:image`; Google `url` replaced by the decoded
  URL, also when the publisher fetch fails; rejected decoded URL → `none` and URL unchanged; circuit
  breaker after 3 decode failures; `limit` and newest-first order; topic restriction;
  `providerHealth` calls for `google/decode` and `yahoo/article`.
- Migration 6: columns present, idempotent re-run.

Frontend (Karma):

- Default view is extended: image and intro rendered.
- Toggle to compact hides both, and the choice survives a re-create (localStorage).
- No `image_url`, or an `(error)` on the image → placeholder.
- NIEUW label inline in extended mode.

## Documentation

CLAUDE.md: `news_articles` columns + schema current 6; the News section gets a "Previews"
paragraph (enrichment step, Google decode risk, hot-linked images); file structure lists
`services/articlePreview.ts` and `services/newsPreviews.ts`.

## Out of scope (addendum)

- An image proxy or local thumbnail cache.
- Retrying a `none` outcome (e.g. after a publisher lifts a 403).
- Previews from article bodies or readability-style extraction.
- A per-topic or per-source toggle; the view mode is global.
