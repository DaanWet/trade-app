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
  app.ts            — builds Express app: mounts 5 routers, CORS, static SPA (prod), error handler; exports `app` (so Electron can run it in-process)
  db.ts             — SQLite singleton, WAL-mode, foreign keys ON
  schema.ts         — DB schema + migrations (idempotent, version-tracked)
  routes/           — trades, positions, prices, tax, settings
  queries/          — trades.ts, prices.ts (better-sqlite3 statements)
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
    taxCalc.ts           — Belgian "meerwaardebelasting" report (per-year, parameterizable)
  helpers/
    constants.ts    — SETTING_KEYS, TRADE_SIDES, PRICE_CACHE_TTL_SECONDS
    errors.ts       — errorMessage(), HttpError class
    settings.ts     — getSetting(), upsertSetting(), getAllSettings()

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
  pages/
    dashboard/    — totals cards + portfolio chart + positions table
    trades/       — list with edit/delete + inline form for new/edit
    tax/          — yearly tax report cards
    settings/     — display currency selector

electron/
  main.ts           — Electron main: in prod require()s backend/dist/app.js, runs Express in-process on random 127.0.0.1 port, loads built Angular SPA; auto-update via electron-updater
  preload.ts        — preload bridge
package.json (root) — build/dist scripts + electron-builder config (asarUnpack better-sqlite3)
```

## DB schema (kern)

- **trades**: id, ticker, trade_date, side ('BUY'/'SELL'), shares, price, currency, fees, notes, created_at
- **tickers** (cache): symbol PK, name, currency, last_price, last_price_at, exchange, quote_type. 5-min TTL on live quotes.
- **fx_rates** (cache): (base, quote, rate_date) PK, rate. Forward-filled across non-trading days; past dates immutable.
- **daily_prices** (cache): (symbol, price_date) PK, close. Forward-filled across non-trading days; past dates immutable.
- **settings**: key-value (display_currency default 'EUR')
- **schema_version**: tracks applied migrations (current: 2)

## API endpoints

- `GET    /api/health` → `{ ok: true }`
- `GET    /api/trades?ticker=X` — list (asc by date)
- `GET    /api/trades/:id` — single
- `POST   /api/trades` — create (zod-validated); fires async ticker quote warm-up
- `PUT    /api/trades/:id` — update
- `DELETE /api/trades/:id` — delete
- `GET    /api/positions` → `{ positions: PositionMetrics[], totals: PortfolioTotals }` (computes FIFO + fetches quotes)
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

## Core domain logic

### FIFO (positionsCalc.ts)

- `walkTrades(trades)` walks one ticker chronologically. BUYs push an `OpenLot` (with proportional buy-fee folded into cost_per_share). SELLs match against open lots in order; each match emits a `RealizedLot` with cost_basis and proceeds (sell-fee folded into proceeds_per_share).
- `computeAllPositions()` runs walkTrades per ticker, fetches live quotes, converts to display currency, sorts (open positions first by market value desc, then closed by realized desc).
- Mixed-currency tickers warn but use the first trade's currency.
- Short positions (selling more than open) warn and are not modeled.

### Currency conversion (fxService.ts)

- All trade amounts stored in **trade currency** (never converted at write time).
- `convert(amount, from, to, date?)` is **non-throwing** — falls back to the unconverted amount if no rate is available (offline / provider down).
- Cache: past-date rates are immutable; today's rate is reused per-day (refreshed at next app start).
- `warmHistoricalRates(pairs, from, to)`: one provider call per pair, then forward-fill the entire range so per-day `convert()` is a pure cache hit. Crucial for portfolio history.

### Stock price caching (marketData.ts + daily_prices)

- `fetchHistorical(sym, from, to)` reads from `daily_prices` first; only hits the provider on cache miss / when `to >= today`.
- After a provider call, missing days in the range are forward-filled from the previous trading day's close.
- After warming, repeated portfolio history calls are nearly free (no provider calls).

### Belgian tax (taxCalc.ts)

- Default params: rate 10%, exemption €10,000/year, applies from year 2026.
- Tax base is **gains only** — losses are tracked separately, not netted (as per BE rules).
- Per-year report converts each realized lot's P&L to display currency using the **sell-date** FX rate.
- Years before `appliesFrom` show `applies: false` and `tax_due: 0`.

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
