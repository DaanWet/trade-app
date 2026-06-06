# Trade App — Project Context for Claude

## Stack

- **Backend**: Node.js + TypeScript + Express 5 + better-sqlite3
- **Frontend**: Angular 21 (standalone components, signals)
- **DB**: SQLite at `backend/data/trades.db`
- **Styling**: Bootstrap 5 + Bootstrap Icons (dark theme)
- **Charts**: Chart.js (registered manually, no wrapper library)
- **Market data**: pluggable providers (`services/providers/`)
  - **FX**: Frankfurter (ECB) — default. No API key, no rate limit. Falls back to `yahooFxProvider` if swapped.
  - **Stock prices**: yahoo-finance2 v3 — default. Quote, historical, search.
- **Ports**: Backend 3100, Frontend 33793
- **CORS**: comma-separated whitelist via `CORS_ORIGIN` env (default: `http://localhost:4200,http://localhost:4222,http://localhost:33793`)

## File structure

```
backend/src/
  index.ts          — standalone dev server: imports app, app.listen(PORT=3100)
  app.ts            — builds Express app: mounts 7 routers, CORS, static SPA (prod), error handler (→ central logger); exports `app` + `setRemoteSink` (so Electron can run it in-process + inject a Sentry sink)
  db.ts             — SQLite singleton, WAL-mode, foreign keys ON
  schema.ts         — DB schema + migrations (idempotent, version-tracked)
  routes/           — trades, positions, prices, tax, settings, cash, diagnostics
  queries/          — trades.ts, prices.ts, cash.ts (better-sqlite3 statements)
  services/
    yahooClient.ts       — single shared yahoo-finance2 v3 instance (used by yahoo* providers)
    providers/
      types.ts             — FxProvider + PriceProvider + DTO interfaces
      index.ts             — registry: which provider is active (defaults: Frankfurter, Yahoo)
      frankfurterFx.ts     — ECB-backed FX provider (no key, no rate limit)
      yahooFx.ts           — Yahoo FX provider (fallback)
      yahooPrice.ts        — Yahoo stock-price provider (default)
    marketData.ts        — quote + historical with daily_prices cache + forward-fill (uses priceProvider)
    fxService.ts         — convert/getRate/warmHistoricalRates with fx_rates cache + forward-fill (uses fxProvider)
    positionsCalc.ts     — FIFO walker (BUY → open lots, SELL → realized lots), per-ticker metrics
    portfolioHistory.ts  — Daily time-series of portfolio market value vs invested
    cashService.ts       — derived cash balance (net deposits − net invested), display currency
    taxCalc.ts           — Belgian "meerwaardebelasting" report (per-year, parameterizable)
  helpers/
    constants.ts    — SETTING_KEYS, TRADE_SIDES, CASH_TX_TYPES, PRICE_CACHE_TTL_SECONDS
    errors.ts       — errorMessage(), HttpError class
    settings.ts     — getSetting(), upsertSetting(), getAllSettings()
    logger.ts       — central logger: console + rotating file (${LOG_DIR}/app.log) + in-memory ring buffer + pluggable remote sink (setRemoteSink); getRecentEvents()/getLogFilePath()

frontend/src/app/
  app.component.{ts,html,scss}  — root layout with Bootstrap navbar
  app.config.ts                 — providers (router, http)
  app.routes.ts                 — lazy-loaded page routes
  models/index.ts               — TypeScript interfaces shared with API contracts
  services/api.service.ts       — all HTTP methods (one observable per endpoint)
  utils/format.ts               — formatMoney, formatNumber, formatPercent, formatShares, formatDate, parseDecimalInput, pnlClass (nl-BE locale)
  shared/
    decimal-input/                 — numeric input accepting ',' or '.' (used by trade-form)
    number-format/format.pipes.ts  — MoneyPipe, NumberPipe, PercentPipe, SharesPipe, DatePipe (standalone)
    positions-table/               — reusable position grid component
    price-chart/portfolio-chart.component.ts — Chart.js line chart (market value vs invested)
    trade-form/                    — create/edit form with ticker autocomplete (Yahoo search)
    cash-form/                     — create/edit form for cash deposits/withdrawals
  pages/
    dashboard/    — totals cards (incl. cash) + allocation bar + portfolio chart + positions table
    trades/       — list with edit/delete + inline form for new/edit
    cash/         — cash balance summary + deposits/withdrawals list with inline form
    tax/          — yearly tax report cards
    settings/     — display currency selector

electron/
  main.ts           — Electron main: in prod require()s backend/dist/app.js, runs Express in-process on random 127.0.0.1 port, loads built Angular SPA; auto-update via electron-updater. Inits Sentry + sets LOG_DIR/APP_VERSION env before requiring backend; injects the Sentry sink into the backend logger after require.
  sentry.ts         — @sentry/electron/main init + PII/financial scrubbing (beforeSend/beforeSendLog) + the sink the backend logger fans out to. DSN-gated (DEFAULT_DSN const / SENTRY_DSN env).
  preload.ts        — preload bridge
package.json (root) — build/dist scripts + electron-builder config (asarUnpack better-sqlite3)
```

## DB schema (kern)

- **trades**: id, ticker, trade_date, side ('BUY'/'SELL'), shares, price, currency, fees, notes, created_at
- **tickers** (cache): symbol PK, name, currency, last_price, last_price_at, exchange, quote_type. 5-min TTL on live quotes.
- **fx_rates** (cache): (base, quote, rate_date) PK, rate. Forward-filled across non-trading days; past dates immutable.
- **daily_prices** (cache): (symbol, price_date) PK, close. Forward-filled across non-trading days; past dates immutable.
- **cash_transactions**: id, type ('DEPOSIT'/'WITHDRAWAL'), amount (>0), currency, tx_date, notes, created_at
- **settings**: key-value (display_currency default 'EUR')
- **schema_version**: tracks applied migrations (current: 3)

## API endpoints

- `GET    /api/health` → `{ ok: true }`
- `GET    /api/trades?ticker=X` — list (asc by date)
- `GET    /api/trades/:id` — single
- `POST   /api/trades` — create (zod-validated); fires async ticker quote warm-up
- `PUT    /api/trades/:id` — update
- `DELETE /api/trades/:id` — delete
- `GET    /api/positions` → `{ positions: PositionMetrics[], totals: PortfolioTotals }` (computes FIFO + fetches quotes)
- `GET    /api/positions/holdings?ticker=&date=&excludeTradeId=` → `{ ticker, shares_held }` (DB-only, no quotes; powers the trade-form SELL check)
- `GET    /api/positions/realized` — all realized FIFO lots (for tax/history)
- `GET    /api/positions/history` — daily portfolio value time-series (uses Yahoo historical chart)
- `GET    /api/prices/search?q=` — Yahoo ticker search (autocomplete)
- `GET    /api/prices/quote/:symbol[?force=1]` — current quote (cache-first)
- `POST   /api/prices/quotes  { symbols: [], force?: bool }` — batch quotes
- `GET    /api/prices/historical/:symbol?from=&to=` — daily closes
- `GET    /api/prices/fx?from=&to=&date=` — single FX rate
- `GET    /api/tax` → `{ params, years: TaxYearReport[] }` (BE meerwaardebelasting)
- `GET    /api/tax/lots` — every realized lot annotated with display-currency P&L + tax year
- `GET    /api/settings`, `GET /api/settings/:key`, `PUT /api/settings`
- `GET    /api/cash` → `{ transactions: CashTxRow[], summary: CashSummary }`
- `POST   /api/cash` — create deposit/withdrawal (zod-validated)
- `PUT    /api/cash/:id`, `DELETE /api/cash/:id`
- `GET    /api/diagnostics` → `{ appVersion, now, logFilePath, counters, settings, recentEvents }` — recent backend log events + scrubbed metadata (local-only, 127.0.0.1)

## Core domain logic

### FIFO (positionsCalc.ts)

- `walkTrades(trades)` walks one ticker chronologically. BUYs push an `OpenLot` (with proportional buy-fee folded into cost_per_share). SELLs match against open lots in order; each match emits a `RealizedLot` with cost_basis and proceeds (sell-fee folded into proceeds_per_share).
- `computeAllPositions()` runs walkTrades per ticker, fetches live quotes, converts to display currency, sorts (open positions first by market value desc, then closed by realized desc).
- Mixed-currency tickers warn but use the first trade's currency.
- Short positions (selling more than open) are **hard-blocked** at write time, so they never reach the walker in practice. `walkTrades` still reports any uncovered SELL via `PositionState.oversold` (and warns); `findShareOverdraw(next, previous)` re-simulates the FIFO history for every affected ticker and returns the first that would go short. `sharesHeld(ticker, {asOf, excludeTradeId})` gives open shares for the holdings endpoint. See the share-overdraw guard under "Cash position".

### Currency conversion (fxService.ts)

- All trade amounts stored in **trade currency** (never converted at write time).
- `convert(amount, from, to, date?)` is **non-throwing** — falls back to the unconverted amount if no rate is available (offline / provider down).
- Cache: past-date rates are immutable; today's rate is reused per-day (refreshed at next app start).
- `warmHistoricalRates(pairs, from, to)`: one provider call per pair, then forward-fill the entire range so per-day `convert()` is a pure cache hit. Crucial for portfolio history.

### Cash position (cashService.ts)

- Single balance in **display currency**, fully **derived** (no ledger): `cash_balance = net_deposits − net_invested`.
- `net_deposits` = Σ DEPOSIT − Σ WITHDRAWAL, each `convert()`ed at its `tx_date`.
- `net_invested` mirrors portfolioHistory's cash-flow formula: BUY reduces cash by `shares*price+fees`, SELL increases it by `shares*price−fees` (each converted at `trade_date`).
- A BUY automatically lowers cash, a SELL raises it — no separate per-trade cash record.
- Cash can still go **negative via trades** (you can buy more than you hold), but each side guards it:
  - **Trades** — a trade change that lowers cash into the negative (a BUY, or **deleting a SELL** which removes its proceeds) triggers a *soft confirm*: `POST/PUT/DELETE /api/trades` returns `409 { code: 'CASH_OVERDRAW' }` unless the request carries `?confirm=1`. The trade-form/list catches the 409, asks the user (custom Bootstrap modal), and retries with `?confirm=1`. Adding a SELL or deleting a BUY (both raise cash) never trip it.
  - **Cash ledger** — a withdrawal (or shrinking/deleting a deposit) that would overdraw is *hard-blocked* with `400` on `POST/PUT/DELETE /api/cash`; no bypass. You can't withdraw cash you don't have.
  - Both reuse `overdraws()` + `projectCashAfter{Trade,CashTx}()` in cashService.ts, built on `tradeCashFlow()` / `cashTxFlow()`.
- **Share overdraw (selling more than you own)** is separately *hard-blocked* with `400 { code: 'INSUFFICIENT_SHARES' }` on `POST/PUT/DELETE /api/trades`; no bypass (`?confirm=1` does not apply). The route calls `findShareOverdraw()` (positionsCalc.ts) before mutating: a new/edited SELL exceeding held shares, a back-dated SELL before its covering BUY, or editing/deleting a BUY that leaves later SELLs uncovered all trip it. The check is chronological (re-simulates the FIFO walk), independent of the cash guard, and runs first. The trade-form fetches `/api/positions/holdings` to show "Je bezit X aandelen" and disables submit before you hit the 400.
- The positions route folds the summary into `PortfolioTotals` (`cash_balance`, `net_worth`, `cash_pct`, `invested_pct`) so the dashboard stays one API call.

### Stock price caching (marketData.ts + daily_prices)

- `fetchHistorical(sym, from, to)` reads from `daily_prices` first; only hits the provider on cache miss / when `to >= today`.
- After a provider call, missing days in the range are forward-filled from the previous trading day's close.
- After warming, repeated portfolio history calls are nearly free (no provider calls).

### Belgian tax (taxCalc.ts)

- Default params: rate 10%, exemption €10,000/year, applies from year 2026, fotomoment date `2025-12-31`.
- **Fotomoment basis**: for lots bought **before 2026**, the close on 31/12/2025 (`priceAt`) is the fiscal
  cost basis. `applyFotomoment(P, S, F)` decides per lot: F ≥ P → `S − F`; F < P → `S − P` if `S ≥ P`,
  `S − F` if `S ≤ F` (loss from fotomoment), else `0` (shield — purchase price neutralizes a recovery but
  never creates a deductible loss). Lots bought in 2026+ just use `S − P`.
- **Same-year losses are netted** against gains before the exemption: `taxable = max(0, (gains − losses) − exemption)`.
  No carry-over between years (`net_gain_pretax = gains − losses`).
- Per-lot components (cost basis, proceeds, fotomoment value) are converted to display currency on the **sell date**.
- `/api/tax/lots` returns each lot enriched with `taxable_pnl_display`, `fotomoment_value_display`, and `basis_used`.
- Years before `appliesFrom` show `applies: false`, `tax_due: 0` (sold pre-2026 → informational economic P&L only).

### Observability & diagnostics (logger.ts + Sentry)

- **Central logger** (`helpers/logger.ts`) is the single choke point. Every `logger.{debug,info,warn,error}(component, msg)` fans out to: (1) the console (unchanged `[component] message` lines), (2) a size-rotated file at `${LOG_DIR}/app.log` (2 MB × 3 files; env `LOG_DIR`, dev fallback `backend/logs/`, prod `${userData}/logs/`), (3) an in-memory ring buffer (last 500 events, mirrors `rateLimitMonitor.ts`), (4) a pluggable remote sink. Logging is best-effort — file/sink errors are swallowed so it can never crash a request. `LOG_DIR` is resolved fresh per write.
- All previously-swallowed provider/FX warnings (`yahooPrice`, `yahooFx`, `frankfurter`, `fx`), the FIFO/tax warnings, the startup banners (`db`, `schema`, `server`, `history`), and the global error handler now route through the logger — so a packaged build leaves a retrievable trace where before there was none.
- **`GET /api/diagnostics`** serves the ring buffer + app version + whitelisted settings (`SAFE_SETTING_KEYS`) + log-file path + counters (`convertFailures`, `rateLimited`). Local-only (127.0.0.1, single-user) → intentionally **not** scrubbed.
- **Remote = Sentry** (`@sentry/electron`, OpenTelemetry-based v10 SDK under the hood). The backend never imports Electron/Sentry: `electron/main.ts` calls `Sentry.init` (before the backend `require`, so require-time throws are caught) then injects a sink via the re-exported `setRemoteSink`. The sink maps warn/info/debug → breadcrumbs and `error` → `captureException`/`captureMessage`. Renderer errors are caught by a minimal `@sentry/electron/renderer` init in `frontend/src/main.ts` (inherits DSN/config from main over IPC).
- **Privacy = cloud + scrub**: `sendDefaultPii:false` + `beforeSend`/`beforeSendLog` drop request bodies/query strings and redact paths/amounts/numbers/tickers (`scrubText` in `electron/sentry.ts`). The local file + `/api/diagnostics` stay unscrubbed by design.
- **DSN config**: Sentry is **DSN-gated** — set `SENTRY_DSN` (env, dev) or paste the public DSN into `DEFAULT_DSN` in `electron/sentry.ts` (for packaged builds; the DSN is a public ingest key, safe to ship). With no DSN, Sentry is skipped and only the local file + `/api/diagnostics` fallback runs (dev/tests stay clean). Future option (documented, not wired): swap the SDK transport for Sentry's direct OTLP endpoints (`…/integration/otlp/v1/{traces,logs}`).

## Locale & formatting

- All number/currency display uses `nl-BE` locale (decimal comma, EUR/USD symbols).
- Pipes are standalone and live in `shared/number-format/format.pipes.ts`. Use them from any standalone component.

## Run locally

```bash
# Backend (terminal 1)
cd backend
npm install
npm run dev          # http://localhost:3100

# Frontend (terminal 2)
cd frontend
npm install
npm start            # http://localhost:4200
```

## Build & package (desktop)

Electron wraps the Angular SPA + Express backend into one desktop app (run from repo root).

- `npm run build` — frontend (prod) + backend + electron (tsc)
- `npm start` — build, then launch Electron locally
- `npm run dist[:linux|:win|:mac]` — electron-builder installer into `release/`
- `npm run rebuild-native` — rebuild better-sqlite3 against Electron's ABI

In production Electron starts the backend in-process (no port 3100 / 33793): it imports `app`
from `backend/dist/app.js` and listens on a random localhost port.

### Dependency parity (root ↔ backend) — important

The backend's runtime deps are installed **twice**: `npm run dev` runs against `backend/node_modules`,
but the packaged app bundles **only the root `node_modules`** (electron-builder `files` does not include
`backend/node_modules`), so `backend/dist/app.js` resolves `express`/`zod`/`yahoo-finance2`/… from **root**
at runtime. Both `package.json`s therefore list the same backend runtime deps, and they **must stay on the
same version** — otherwise the packaged app silently runs a different version than dev. (This bit us once:
root shipped `yahoo-finance2` 3.14.0 with a stale response schema → `Failed Yahoo Schema validation` →
empty ticker search, while dev ran 3.15.2.) `better-sqlite3` is the deliberate exception: it lives in both
(backend = Node ABI for dev, root = Electron ABI for the package) at the same version, and `electron/main.ts`
forces it to resolve from root via a `_resolveFilename` override.
`npm run check:deps` (a `build` pre-step, [scripts/check-dep-parity.cjs](scripts/check-dep-parity.cjs))
compares the installed root vs backend versions and **fails the build on any drift**.

`.github/workflows/release.yml` auto-tags from the package.json version and publishes
linux/win/mac builds to a GitHub Release.

## Runtime requirements

- **Node.js**: 22 LTS or newer (yahoo-finance2 v3 requires Node ≥ 22; better-sqlite3 12 requires Node ≥ 20).

## Known limitations / future work

- News agent (Claude Agent SDK) for tickers in your watchlist — not yet implemented.
- No authentication — single-user local app. Don't expose to the internet without adding auth.

## Native module tip

`better-sqlite3` is a native module. After switching Node versions or copying `node_modules` between machines you may see `NODE_MODULE_VERSION` errors at startup. Fix for bare-Node backend dev: `npm rebuild better-sqlite3` (or nuke `node_modules` and `npm install`). Inside the Electron build (different ABI), use `npm run rebuild-native` (electron-rebuild) instead.

## Code Style

- Prettier: 100 char width, double quotes, ES5 trailing commas
- 2-space indentation
- Standalone components (Angular 21, standalone-by-default)
- Templates use built-in control flow (`@if`/`@for`/`@switch`), not `*ngIf`/`*ngFor` — no `CommonModule` import needed
