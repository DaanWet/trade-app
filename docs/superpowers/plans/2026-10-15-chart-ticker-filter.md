# Chart Ticker Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dashboard's portfolio chart show a selection of tickers (picked one by one or via status/type/currency shortcuts) as "value of the selection" + "Geïnvesteerd", in € and in %.

**Architecture:** The backend's history builder already values every ticker per day; it now also returns that breakdown (`by_ticker: { value, invested }`) in every point, and positions carry `quote_type`. The frontend sums the selected tickers client-side: pure utils decide groups/selection (`ticker-groups.ts`) and which lines to draw (`chart-lines.ts`), a small dropdown component edits the selection, the dashboard persists it, and the chart component just draws the lines it is given.

**Tech Stack:** Node 22 + TypeScript + Express 5 + better-sqlite3 + vitest (backend); Angular 21 standalone + signals + Bootstrap 5 + Chart.js 4 + Karma/Jasmine (frontend).

**Spec:** `docs/superpowers/specs/2026-10-15-chart-ticker-filter-design.md`

## Global Constraints

- Node.js ≥ 22. No new dependencies (backend or frontend).
- Formatting: Prettier, 100-char width, 2-space indent. Quotes follow the surrounding file: backend `src/` and all frontend files use single quotes; backend `*.test.ts` files use double quotes.
- Angular: standalone components, signals (`input()`, `output()`, `computed()`), built-in control flow (`@if`/`@for`); no `CommonModule`.
- Comments follow the file's language: frontend utils and models are Dutch, the chart component and backend are English.
- UI copy, exactly: `Alle`, `Alle tickers`, `Status`, `Type`, `Valuta`, `Open`, `Gesloten`, `Aandeel`, `ETF`, `Fonds`, `Future`, `FX`, `Crypto`, `Index`, `Overig`, `Geïnvesteerd`, `` `${n} tickers` ``, `Deze selectie had geen posities in dit bereik.`
- `quote_type` mapping: `EQUITY` → Aandeel, `ETF` → ETF, `MUTUALFUND` → Fonds, `FUTURE` → Future, `CURRENCY` → FX, `CRYPTOCURRENCY` → Crypto, `INDEX` → Index; `null`/other → Overig.
- Currency groups use the **quote** currency (`PositionMetrics.quote_currency`).
- The selection persists in localStorage under `chart.tickers` via `persistedString` (comma-separated symbols, `''` = all).
- The filter affects the chart only — totals cards, allocation and positions table are untouched.
- Git: trunk-based — work on `main`, no branches or worktrees. Per-task `wip(#4)` commits are fine; Task 7 squashes them (with spec + plan) into **one** commit on top of `220d08b`. Never push. No `Co-Authored-By` line.

## Review Focus

- A stale or garbage stored selection (`chart.tickers` = `GONE`, `,,`, `AMD,AMD`) must fall back to "Alle" / de-duplicate, never show an empty chart — pinned in Task 3 (`parseSelection` tests).
- Symbols containing `=` or `.` (`NG=F`, `KBC.BR`, `ZAR=X`) must survive storage round-trips and show as themselves in the label — pinned in Task 3.
- A selected ticker bought only inside the visible range (absent from earlier points) counts as 0 there, and its % line starts at 0 % with no NaN — pinned in Task 4.
- A selection fully sold before the visible range must show the "Deze selectie had geen posities in dit bereik." message, not a flat 0 line — pinned in Task 4 (`hasSelectionData`).
- Switching Alle ↔ selection ↔ % on the live chart must replace the lines without leftovers (no "Aandelen" lingering next to a selection) — pinned in Task 5 (component spec).

## Commands

- Backend, one file: `cd /home/daan/trade-app/backend && npx vitest run src/services/portfolioHistory.test.ts`
- Backend, all + typecheck: `cd /home/daan/trade-app/backend && npm test && npx tsc --noEmit`
- Frontend, one spec: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless --include src/app/utils/ticker-groups.spec.ts` (if `--include` is rejected by the builder, drop it and run all specs)
- Frontend, all: same command without `--include`.
- Frontend build/typecheck: `cd /home/daan/trade-app/frontend && npx ng build` (the existing "initial bundle exceeds 500 kB budget" warning is pre-existing; errors are not).

---

### Task 1: Per-ticker breakdown in the portfolio history (backend)

**Files:**
- Modify: `backend/src/services/portfolioHistory.ts`
- Test: `backend/src/services/portfolioHistory.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface TickerSlice { value: number; invested: number }` and `PortfolioPoint.by_ticker: Record<string, TickerSlice>` (display currency; a ticker is present from its first trade onwards; after a sell-out `value` is 0 and `invested` frozen). Invariants per point: `Σ value = market_value`, `Σ invested = net_deposits − cash`.

- [ ] **Step 1: Update the existing exact-shape assertions**

The existing tests compare whole points with `toEqual`, so they must now expect `by_ticker`. In `backend/src/services/portfolioHistory.test.ts`:

Replace
```ts
    expect(out).toEqual([
      { date: "2026-01-02", market_value: 0, cash: 1000, total: 1000, net_deposits: 1000 },
    ]);
```
with
```ts
    expect(out).toEqual([
      { date: "2026-01-02", market_value: 0, cash: 1000, total: 1000, net_deposits: 1000, by_ticker: {} },
    ]);
```

Replace
```ts
    expect(out).toEqual([
      { date: "2026-01-02", market_value: 0, cash: 1000, total: 1000, net_deposits: 1000 },
      { date: "2026-02-01", market_value: 0, cash: 700, total: 700, net_deposits: 700 },
    ]);
```
with
```ts
    expect(out).toEqual([
      { date: "2026-01-02", market_value: 0, cash: 1000, total: 1000, net_deposits: 1000, by_ticker: {} },
      { date: "2026-02-01", market_value: 0, cash: 700, total: 700, net_deposits: 700, by_ticker: {} },
    ]);
```

Replace
```ts
    expect(Object.keys(out[0])).toEqual(["date", "market_value", "cash", "total", "net_deposits"]);
```
with
```ts
    expect(Object.keys(out[0])).toEqual(["date", "market_value", "cash", "total", "net_deposits", "by_ticker"]);
```

Replace
```ts
    expect(out[0]).toEqual({
      date: "2026-01-02",
      market_value: 0,
      cash: 1000,
      total: 1000,
      net_deposits: 1000,
    });
```
with
```ts
    expect(out[0]).toEqual({
      date: "2026-01-02",
      market_value: 0,
      cash: 1000,
      total: 1000,
      net_deposits: 1000,
      by_ticker: {},
    });
```

- [ ] **Step 2: Add the failing tests for `by_ticker`**

Append to `backend/src/services/portfolioHistory.test.ts`:

```ts
// Issue #4: the chart's ticker filter sums a selection client-side, so every point carries
// each ticker's own value and net invested amount.
describe("buildPortfolioHistory — per-ticker breakdown", () => {
  const at = (out: Awaited<ReturnType<typeof buildPortfolioHistory>>, date: string) => {
    const p = out.find((x) => x.date === date);
    if (!p) throw new Error(`no point on ${date}`);
    return p;
  };

  it("splits value and invested per ticker, summing to the totals", async () => {
    upsertTicker({ symbol: "AAPL", name: "Apple", currency: "USD", last_price: 200, last_price_at: new Date().toISOString() });
    insertCashTx({ type: "DEPOSIT", amount: 5000, currency: "EUR", tx_date: "2026-01-02" });
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 150, currency: "USD", fees: 2 });
    insertTrade({ ticker: "BBB", trade_date: "2026-01-06", side: "BUY", shares: 20, price: 50, currency: "EUR", fees: 1 });
    insertTrade({ ticker: "BBB", trade_date: "2026-01-08", side: "SELL", shares: 5, price: 55, currency: "EUR", fees: 1 });
    upsertDailyPrice({ symbol: "AAPL", price_date: "2026-01-05", close: 200 });
    upsertDailyPrice({ symbol: "AAPL", price_date: today, close: 200 });
    upsertDailyPrice({ symbol: "BBB", price_date: "2026-01-05", close: 52 });
    upsertDailyPrice({ symbol: "BBB", price_date: today, close: 52 });

    const out = await buildPortfolioHistory();

    for (const p of out) {
      const slices = Object.values(p.by_ticker);
      expect(slices.reduce((s, x) => s + x.value, 0)).toBeCloseTo(p.market_value, 6);
      expect(slices.reduce((s, x) => s + x.invested, 0)).toBeCloseTo(p.net_deposits - p.cash, 6);
    }
    const last = out[out.length - 1];
    // 10 × $200 × 0.9; bought for ($1500 + $2 fee) × 0.9.
    expect(last.by_ticker.AAPL.value).toBeCloseTo(1800, 6);
    expect(last.by_ticker.AAPL.invested).toBeCloseTo(1351.8, 6);
    // 15 left × 52; (1000 + 1) in, (275 − 1) back out.
    expect(last.by_ticker.BBB.value).toBeCloseTo(780, 6);
    expect(last.by_ticker.BBB.invested).toBeCloseTo(727, 6);
  });

  it("keeps a sold-out ticker at value 0 with its invested frozen", async () => {
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 60, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "AAA", trade_date: "2026-01-07", side: "SELL", shares: 10, price: 80, currency: "EUR", fees: 0 });
    // BBB keeps a price on every day, so points keep being emitted after AAA is gone.
    insertTrade({ ticker: "BBB", trade_date: "2026-01-05", side: "BUY", shares: 1, price: 10, currency: "EUR", fees: 0 });
    upsertDailyPrice({ symbol: "AAA", price_date: "2026-01-05", close: 70 });
    upsertDailyPrice({ symbol: "AAA", price_date: today, close: 80 });
    upsertDailyPrice({ symbol: "BBB", price_date: "2026-01-05", close: 10 });
    upsertDailyPrice({ symbol: "BBB", price_date: today, close: 10 });

    const out = await buildPortfolioHistory();

    expect(at(out, "2026-01-05").by_ticker.AAA).toEqual({ value: 700, invested: 600 });
    // Sold everything at 80: 800 back out of 600 put in → net invested −200, nothing left.
    expect(at(out, "2026-01-07").by_ticker.AAA).toEqual({ value: 0, invested: -200 });
    expect(at(out, "2026-01-08").by_ticker.AAA).toEqual({ value: 0, invested: -200 });
  });

  it("lists a ticker only from its first trade onwards", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 1, price: 10, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "BBB", trade_date: "2026-01-07", side: "BUY", shares: 1, price: 10, currency: "EUR", fees: 0 });
    upsertDailyPrice({ symbol: "AAA", price_date: "2026-01-05", close: 10 });
    upsertDailyPrice({ symbol: "AAA", price_date: today, close: 10 });
    upsertDailyPrice({ symbol: "BBB", price_date: "2026-01-05", close: 10 });
    upsertDailyPrice({ symbol: "BBB", price_date: today, close: 10 });

    const out = await buildPortfolioHistory();

    expect(at(out, "2026-01-02").by_ticker).toEqual({});
    expect(Object.keys(at(out, "2026-01-05").by_ticker)).toEqual(["AAA"]);
    expect(Object.keys(at(out, "2026-01-07").by_ticker).sort()).toEqual(["AAA", "BBB"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/daan/trade-app/backend && npx vitest run src/services/portfolioHistory.test.ts`
Expected: FAIL — the updated shape assertions and the new tests fail because points have no `by_ticker` (e.g. `Cannot read properties of undefined (reading 'AAPL')`).

- [ ] **Step 4: Implement the breakdown**

In `backend/src/services/portfolioHistory.ts`, replace the `PortfolioPoint` interface with:

```ts
/** One ticker's share of a point, in display currency. */
export interface TickerSlice {
  value: number; // market value that day (0 once sold out, or when no close is known)
  invested: number; // cumulative net trade cash flow into it (buys − sells, fees included)
}

export interface PortfolioPoint {
  date: string;
  market_value: number; // stocks only
  cash: number; // cash balance that day (net_deposits − invested)
  total: number; // market_value + cash
  net_deposits: number; // cumulative net deposits that day
  /** Per ticker, from its first trade onwards — powers the chart's ticker filter. */
  by_ticker: Record<string, TickerSlice>;
}
```

Add one line to the doc comment of `buildPortfolioHistory`, after the "Replay cash transactions…" bullet:

```ts
 *  - Keep each ticker's value and net invested amount too (`by_ticker`), so the chart can
 *    sum any selection of tickers client-side.
```

Replace
```ts
  const shares = new Map<string, number>();
  let invested = 0;
```
with
```ts
  const shares = new Map<string, number>();
  const investedByTicker = new Map<string, number>();
  let invested = 0;
```

Replace
```ts
      shares.set(t.ticker, (shares.get(t.ticker) ?? 0) + sign * t.shares);
      invested += await convert(tradeCashFlow(t), t.currency, displayCurrency, t.trade_date);
```
with
```ts
      shares.set(t.ticker, (shares.get(t.ticker) ?? 0) + sign * t.shares);
      const flow = await convert(tradeCashFlow(t), t.currency, displayCurrency, t.trade_date);
      invested += flow;
      investedByTicker.set(t.ticker, (investedByTicker.get(t.ticker) ?? 0) + flow);
```

Replace
```ts
    let mv = 0;
    let hasAnyPrice = false;
```
with
```ts
    let mv = 0;
    let hasAnyPrice = false;
    const valueByTicker = new Map<string, number>();
```

Replace
```ts
      if (price != null) {
        hasAnyPrice = true;
        mv += await convert(qty * price, tickerCurrency.get(ticker)!, displayCurrency, day);
      }
```
with
```ts
      if (price != null) {
        hasAnyPrice = true;
        const value = await convert(qty * price, tickerCurrency.get(ticker)!, displayCurrency, day);
        mv += value;
        valueByTicker.set(ticker, value);
      }
```

Replace
```ts
      const cash = netDeposits - invested;
      out.push({ date: day, market_value: mv, cash, total: mv + cash, net_deposits: netDeposits });
```
with
```ts
      const cash = netDeposits - invested;
      // Every ticker traded so far, sold-out ones included (value 0, invested frozen), so a
      // selection's lines stay continuous. Σ value = mv and Σ invested = invested.
      const byTicker: Record<string, TickerSlice> = {};
      for (const [ticker, tickerInvested] of investedByTicker) {
        byTicker[ticker] = { value: valueByTicker.get(ticker) ?? 0, invested: tickerInvested };
      }
      out.push({
        date: day,
        market_value: mv,
        cash,
        total: mv + cash,
        net_deposits: netDeposits,
        by_ticker: byTicker,
      });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/daan/trade-app/backend && npx vitest run src/services/portfolioHistory.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
cd /home/daan/trade-app
git add backend/src/services/portfolioHistory.ts backend/src/services/portfolioHistory.test.ts
git commit -m "wip(#4): per-ticker breakdown in portfolio history"
```

---

### Task 2: `quote_type` on positions (backend)

**Files:**
- Modify: `backend/src/services/positionsCalc.ts` (interface `PositionMetrics` ~line 52; return object of `metricsFromState` ~line 413)
- Test: `backend/src/services/positionsCalc.test.ts`

**Interfaces:**
- Consumes: `TickerRow.quote_type` (already in `backend/src/queries/prices.ts`; `fetchQuotes` returns full `TickerRow`s).
- Produces: `PositionMetrics.quote_type: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/services/positionsCalc.test.ts`:

```ts
// Issue #4: the chart's ticker filter groups positions by instrument type.
describe("computeAllPositions — quote type", () => {
  it("carries the instrument type from the tickers cache", async () => {
    upsertTicker({
      symbol: "VWCE",
      name: "VWCE",
      currency: "EUR",
      last_price: 100,
      last_price_at: new Date().toISOString(),
      quote_type: "ETF",
    });
    insertTrade({ ticker: "VWCE", trade_date: "2026-01-05", side: "BUY", shares: 1, price: 90, currency: "EUR", fees: 0 });

    expect((await positionFor("VWCE")).quote_type).toBe("ETF");
  });

  it("leaves the type null when the cache doesn't know it", async () => {
    seedFreshQuote("AAA", 10);
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 1, price: 10, currency: "EUR", fees: 0 });

    expect((await positionFor("AAA")).quote_type).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/daan/trade-app/backend && npx vitest run src/services/positionsCalc.test.ts`
Expected: FAIL — `expected undefined to be 'ETF'` and `expected undefined to be null`.

- [ ] **Step 3: Implement**

In `backend/src/services/positionsCalc.ts`, in `interface PositionMetrics`, after the `quote_currency` line add:

```ts
  quote_type: string | null;   // instrument type from the tickers cache (EQUITY, ETF, …); null when unknown
```

In the object returned by `metricsFromState`, after `quote_currency: quoteCurrency,` add:

```ts
    quote_type: quote?.quote_type ?? null,
```

- [ ] **Step 4: Run all backend tests and the typecheck**

Run: `cd /home/daan/trade-app/backend && npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /home/daan/trade-app
git add backend/src/services/positionsCalc.ts backend/src/services/positionsCalc.test.ts
git commit -m "wip(#4): quote_type on positions"
```

---

### Task 3: Frontend models + ticker groups and selection helpers

**Files:**
- Modify: `frontend/src/app/models/index.ts` (`PositionMetrics`, `PortfolioPoint`)
- Modify: `frontend/src/app/utils/allocation.spec.ts` (`pos()` helper must include the new field)
- Create: `frontend/src/app/utils/ticker-groups.ts`
- Test: `frontend/src/app/utils/ticker-groups.spec.ts`

**Interfaces:**
- Consumes: backend contract from Tasks 1–2.
- Produces (all exported from `frontend/src/app/utils/ticker-groups.ts`):
  - `interface TickerGroup { key: string; label: string; tickers: string[] }`
  - `interface TickerGroupRow { key: 'status' | 'type' | 'currency'; label: string; groups: TickerGroup[] }`
  - `typeLabel(quoteType: string | null): string`
  - `buildTickerGroups(positions: PositionMetrics[]): TickerGroupRow[]`
  - `sameTickers(a: string[], b: string[] | null): boolean`
  - `selectionLabel(selection: string[] | null, rows: TickerGroupRow[]): string`
  - `toggleTicker(selection: string[] | null, ticker: string): string[] | null`
  - `parseSelection(stored: string, positions: PositionMetrics[]): string[] | null`
  - `serializeSelection(selection: string[] | null): string`
  - Models: `interface TickerSlice { value: number; invested: number }`, `PortfolioPoint.by_ticker: Record<string, TickerSlice>`, `PositionMetrics.quote_type: string | null`.

- [ ] **Step 1: Extend the models**

In `frontend/src/app/models/index.ts`, in `interface PositionMetrics`, after the `quote_currency` field add:

```ts
  /** Soort instrument uit de ticker-cache (EQUITY, ETF, FUTURE, …). Null als onbekend. */
  quote_type: string | null;
```

Replace the `PortfolioPoint` interface with:

```ts
export interface TickerSlice {
  value: number; // marktwaarde die dag (0 na volledige verkoop of zonder koers)
  invested: number; // netto erin gestoken tot die dag (aankopen − verkopen, kosten inbegrepen)
}

export interface PortfolioPoint {
  date: string;
  market_value: number; // stocks only
  cash: number; // cash balance that day
  total: number; // market_value + cash
  net_deposits: number; // cumulative net deposits
  /** Per ticker vanaf zijn eerste trade — voedt het tickerfilter van de grafiek. */
  by_ticker: Record<string, TickerSlice>;
}
```

In `frontend/src/app/utils/allocation.spec.ts`, in the object returned by `pos()`, after `quote_currency: 'EUR',` add:

```ts
    quote_type: null,
```

- [ ] **Step 2: Write the failing spec**

Create `frontend/src/app/utils/ticker-groups.spec.ts`:

```ts
import type { PositionMetrics } from '../models';
import {
  buildTickerGroups,
  parseSelection,
  selectionLabel,
  serializeSelection,
  toggleTicker,
  typeLabel,
} from './ticker-groups';

/** Alleen ticker, type, noteringsmunt en open/gesloten doen ertoe; de rest is opvulling. */
function pos(
  ticker: string,
  quoteType: string | null,
  quoteCurrency: string,
  isOpen = true,
): PositionMetrics {
  return {
    ticker,
    currency: 'EUR',
    quote_currency: quoteCurrency,
    quote_type: quoteType,
    name: `${ticker} Inc`,
    shares_open: isOpen ? 1 : 0,
    avg_cost: 0,
    avg_realized_cost: null,
    avg_realized_sell: null,
    cost_basis: 0,
    current_price: null,
    previous_close: null,
    price_as_of: null,
    market_value: null,
    unrealized_pnl: null,
    unrealized_pct: null,
    realized_pnl: 0,
    total_pnl: null,
    total_buys: 1,
    total_sells: 0,
    is_open: isOpen,
    display_currency: 'EUR',
    cost_basis_display: 0,
    market_value_display: null,
    unrealized_pnl_display: null,
    realized_pnl_display: 0,
    total_pnl_display: null,
    day_pnl_display: null,
    day_pnl_pct: null,
  };
}

const PORTFOLIO: PositionMetrics[] = [
  pos('AMD', 'EQUITY', 'USD'),
  pos('CAS', 'ETF', 'USD'),
  pos('HYPG', 'ETF', 'USD'),
  pos('KBC.BR', 'EQUITY', 'EUR'),
  pos('NG=F', 'FUTURE', 'USD', false),
  pos('ZAR=X', 'CURRENCY', 'ZAR'),
];

describe('buildTickerGroups', () => {
  it('maakt rijen voor status, type en valuta met enkel niet-lege groepen', () => {
    const rows = buildTickerGroups(PORTFOLIO);

    expect(rows.map(r => r.key)).toEqual(['status', 'type', 'currency']);
    expect(rows[0].groups.map(g => [g.label, g.tickers])).toEqual([
      ['Open', ['AMD', 'CAS', 'HYPG', 'KBC.BR', 'ZAR=X']],
      ['Gesloten', ['NG=F']],
    ]);
    expect(rows[1].groups.map(g => g.label)).toEqual(['Aandeel', 'ETF', 'Future', 'FX']);
    expect(rows[2].groups.map(g => [g.label, g.tickers])).toEqual([
      ['EUR', ['KBC.BR']],
      ['USD', ['AMD', 'CAS', 'HYPG', 'NG=F']],
      ['ZAR', ['ZAR=X']],
    ]);
  });

  it('laat Gesloten weg als alles open is', () => {
    const rows = buildTickerGroups([pos('AMD', 'EQUITY', 'USD')]);

    expect(rows[0].groups.map(g => g.label)).toEqual(['Open']);
  });

  it('groepeert een onbekend of ontbrekend type onder Overig', () => {
    const rows = buildTickerGroups([pos('AAA', null, 'EUR'), pos('BBB', 'WARRANT', 'EUR')]);
    const type = rows.find(r => r.key === 'type')!;

    expect(type.groups).toEqual([{ key: 'type:Overig', label: 'Overig', tickers: ['AAA', 'BBB'] }]);
  });

  it('groepeert op noteringsmunt, niet op handelsmunt', () => {
    // pos() boekt altijd in EUR; de noteringsmunt is USD.
    const rows = buildTickerGroups([pos('AMD', 'EQUITY', 'USD')]);

    expect(rows.find(r => r.key === 'currency')!.groups.map(g => g.label)).toEqual(['USD']);
  });

  it('geeft geen rijen zonder posities', () => {
    expect(buildTickerGroups([])).toEqual([]);
  });
});

describe('typeLabel', () => {
  it('noemt CURRENCY "FX", zodat het niet botst met de rij Valuta', () => {
    expect(typeLabel('CURRENCY')).toBe('FX');
  });
});

describe('selectionLabel', () => {
  const rows = buildTickerGroups(PORTFOLIO);

  it('toont "Alle tickers" zonder selectie', () => {
    expect(selectionLabel(null, rows)).toBe('Alle tickers');
  });

  it('toont de groepsnaam als de selectie precies een groep is, in eender welke volgorde', () => {
    expect(selectionLabel(['HYPG', 'CAS'], rows)).toBe('ETF');
  });

  it('toont het symbool bij één ticker, ook als die in zijn eentje een groep vormt', () => {
    // NG=F is in z'n eentje ook de groepen Gesloten en Future.
    expect(selectionLabel(['NG=F'], rows)).toBe('NG=F');
  });

  it('telt de tickers bij een losse selectie', () => {
    expect(selectionLabel(['AMD', 'CAS'], rows)).toBe('2 tickers');
  });
});

describe('toggleTicker', () => {
  it('selecteert vanuit alle enkel de aangeklikte ticker', () => {
    expect(toggleTicker(null, 'AMD')).toEqual(['AMD']);
  });

  it('voegt toe en haalt weg', () => {
    expect(toggleTicker(['AMD'], 'CAS')).toEqual(['AMD', 'CAS']);
    expect(toggleTicker(['AMD', 'CAS'], 'AMD')).toEqual(['CAS']);
  });

  it('gaat terug naar alle bij het afvinken van de laatste', () => {
    expect(toggleTicker(['AMD'], 'AMD')).toBeNull();
  });
});

describe('parseSelection / serializeSelection', () => {
  it('bewaart symbolen met = en . ongeschonden', () => {
    const stored = serializeSelection(['ZAR=X', 'KBC.BR', 'NG=F']);

    expect(stored).toBe('KBC.BR,NG=F,ZAR=X');
    expect(parseSelection(stored, PORTFOLIO)).toEqual(['KBC.BR', 'NG=F', 'ZAR=X']);
  });

  it('laat tickers vallen die niet meer bestaan', () => {
    expect(parseSelection('AMD,GONE', PORTFOLIO)).toEqual(['AMD']);
  });

  it('valt terug op alle bij leeg, onzin of niets meer over', () => {
    expect(parseSelection('', PORTFOLIO)).toBeNull();
    expect(parseSelection(',,', PORTFOLIO)).toBeNull();
    expect(parseSelection('GONE', PORTFOLIO)).toBeNull();
  });

  it('ontdubbelt', () => {
    expect(parseSelection('AMD,AMD', PORTFOLIO)).toEqual(['AMD']);
  });

  it('schrijft alle weg als lege tekst', () => {
    expect(serializeSelection(null)).toBe('');
  });
});
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless --include src/app/utils/ticker-groups.spec.ts`
Expected: FAIL — build error `Cannot find module './ticker-groups'`.

- [ ] **Step 4: Implement**

Create `frontend/src/app/utils/ticker-groups.ts`:

```ts
/**
 * Groepen en selectie voor het tickerfilter van de portefeuillegrafiek.
 *
 * Een selectie is altijd een lijst tickers, of `null` voor alle tickers. Groepen zijn
 * snelkeuzes: een klik vervangt de selectie door de tickers van die groep. Puur en zonder
 * Angular, zodat het dashboard en de filtercomponent dezelfde regels delen.
 */
import type { PositionMetrics } from '../models';

export interface TickerGroup {
  key: string;
  label: string;
  tickers: string[];
}

export interface TickerGroupRow {
  key: 'status' | 'type' | 'currency';
  label: string;
  groups: TickerGroup[];
}

/** Yahoo's quoteType → label, in de volgorde van de knoppen. CURRENCY heet "FX" zodat het
 *  niet botst met de rij "Valuta". */
const TYPE_LABELS: Record<string, string> = {
  EQUITY: 'Aandeel',
  ETF: 'ETF',
  MUTUALFUND: 'Fonds',
  FUTURE: 'Future',
  CURRENCY: 'FX',
  CRYPTOCURRENCY: 'Crypto',
  INDEX: 'Index',
};
const OTHER_TYPE = 'Overig';

export function typeLabel(quoteType: string | null): string {
  return TYPE_LABELS[quoteType ?? ''] ?? OTHER_TYPE;
}

function tickersWhere(
  positions: PositionMetrics[],
  keep: (p: PositionMetrics) => boolean,
): string[] {
  return positions.filter(keep).map(p => p.ticker);
}

/** De drie rijen snelkeuzes (status, type, valuta); lege groepen en lege rijen vallen weg. */
export function buildTickerGroups(positions: PositionMetrics[]): TickerGroupRow[] {
  const status: TickerGroup[] = [
    { key: 'status:open', label: 'Open', tickers: tickersWhere(positions, p => p.is_open) },
    {
      key: 'status:closed',
      label: 'Gesloten',
      tickers: tickersWhere(positions, p => !p.is_open),
    },
  ];

  const types: TickerGroup[] = [...Object.values(TYPE_LABELS), OTHER_TYPE].map(label => ({
    key: `type:${label}`,
    label,
    tickers: tickersWhere(positions, p => typeLabel(p.quote_type) === label),
  }));

  // Noteringsmunt, niet de handelsmunt: daar zit het wisselkoersrisico.
  const currencies = [...new Set(positions.map(p => p.quote_currency))].sort();
  const byCurrency: TickerGroup[] = currencies.map(c => ({
    key: `currency:${c}`,
    label: c,
    tickers: tickersWhere(positions, p => p.quote_currency === c),
  }));

  const rows: TickerGroupRow[] = [
    { key: 'status', label: 'Status', groups: status },
    { key: 'type', label: 'Type', groups: types },
    { key: 'currency', label: 'Valuta', groups: byCurrency },
  ];
  return rows
    .map(r => ({ ...r, groups: r.groups.filter(g => g.tickers.length > 0) }))
    .filter(r => r.groups.length > 0);
}

/** Dezelfde tickers, in eender welke volgorde. `null` (alle) is nooit gelijk aan een groep. */
export function sameTickers(a: string[], b: string[] | null): boolean {
  if (b === null || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every(t => set.has(t));
}

/** Tekst op de filterknop en in de legende. Eén ticker toont zijn symbool, ook als die in
 *  zijn eentje een groep vormt — "NG=F" zegt meer dan "Future". */
export function selectionLabel(selection: string[] | null, rows: TickerGroupRow[]): string {
  if (selection === null) return 'Alle tickers';
  if (selection.length === 1) return selection[0];
  for (const row of rows) {
    for (const group of row.groups) {
      if (sameTickers(group.tickers, selection)) return group.label;
    }
  }
  return `${selection.length} tickers`;
}

/** Vink een ticker aan of af. Bij "alle" staat niets aangevinkt, dus de eerste klik toont
 *  enkel die ticker; de laatste afvinken gaat terug naar alle. */
export function toggleTicker(selection: string[] | null, ticker: string): string[] | null {
  const current = selection ?? [];
  const next = current.includes(ticker)
    ? current.filter(t => t !== ticker)
    : [...current, ticker];
  return next.length > 0 ? next : null;
}

/** Bewaarde selectie ('AMD,NVDA') → lijst, beperkt tot tickers die nog bestaan en zonder
 *  dubbels. Leeg of niets meer over → `null` (alle). */
export function parseSelection(stored: string, positions: PositionMetrics[]): string[] | null {
  const known = new Set(positions.map(p => p.ticker));
  const picked = [...new Set(stored.split(',').filter(t => known.has(t)))];
  return picked.length > 0 ? picked : null;
}

/** Omgekeerde van parseSelection; gesorteerd, zodat dezelfde selectie altijd dezelfde
 *  waarde oplevert. */
export function serializeSelection(selection: string[] | null): string {
  return selection === null ? '' : [...selection].sort().join(',');
}
```

- [ ] **Step 5: Run all frontend specs**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS — the new spec plus the existing `allocation.spec.ts` and `returns.spec.ts` (the full run proves the `quote_type` addition compiles everywhere).

- [ ] **Step 6: Commit**

```bash
cd /home/daan/trade-app
git add frontend/src/app/models/index.ts frontend/src/app/utils/allocation.spec.ts frontend/src/app/utils/ticker-groups.ts frontend/src/app/utils/ticker-groups.spec.ts
git commit -m "wip(#4): ticker groups and selection helpers"
```

---

### Task 4: Which lines the chart draws (pure)

**Files:**
- Create: `frontend/src/app/utils/chart-lines.ts`
- Test: `frontend/src/app/utils/chart-lines.spec.ts`

**Interfaces:**
- Consumes: `PortfolioPoint` with `by_ticker` (Task 3); `timeWeightedReturns(values: number[], flows: number[]): number[]` from `frontend/src/app/utils/returns.ts` (already exists; percent units, first point 0, inflows count from the start of a period, outflows at its end).
- Produces (exported from `frontend/src/app/utils/chart-lines.ts`):
  - `type ChartLineKey = 'total' | 'stocks' | 'deposits' | 'selection' | 'selectionInvested'`
  - `interface ChartLine { key: ChartLineKey; label: string; data: number[] }`
  - `buildChartLines(points: PortfolioPoint[], selection: string[] | null, selectionLabel: string, percent: boolean): ChartLine[]`
  - `hasSelectionData(points: PortfolioPoint[], selection: string[] | null): boolean`

- [ ] **Step 1: Write the failing spec**

Create `frontend/src/app/utils/chart-lines.spec.ts`:

```ts
import type { PortfolioPoint } from '../models';
import { buildChartLines, hasSelectionData } from './chart-lines';

function point(date: string, fields: Partial<PortfolioPoint> = {}): PortfolioPoint {
  return { date, market_value: 0, cash: 0, total: 0, net_deposits: 0, by_ticker: {}, ...fields };
}

// 1000 gestort; dag 2 AAA gekocht voor 600; dag 3 AAA +10 % en BBB gekocht voor 200.
const POINTS: PortfolioPoint[] = [
  point('2026-01-02', { cash: 1000, total: 1000, net_deposits: 1000 }),
  point('2026-01-05', {
    market_value: 600,
    cash: 400,
    total: 1000,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 600, invested: 600 } },
  }),
  point('2026-01-06', {
    market_value: 860,
    cash: 200,
    total: 1060,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 660, invested: 600 }, BBB: { value: 200, invested: 200 } },
  }),
];

describe('buildChartLines zonder selectie', () => {
  it('tekent in € Totaal, Aandelen en Netto stortingen zoals ze zijn', () => {
    const lines = buildChartLines(POINTS, null, '', false);

    expect(lines.map(l => [l.key, l.label])).toEqual([
      ['total', 'Totaal'],
      ['stocks', 'Aandelen'],
      ['deposits', 'Netto stortingen'],
    ]);
    expect(lines[0].data).toEqual([1000, 1000, 1060]);
    expect(lines[1].data).toEqual([0, 600, 860]);
    expect(lines[2].data).toEqual([1000, 1000, 1000]);
  });

  it('rekent in % het tijdgewogen rendement en laat Netto stortingen weg', () => {
    const lines = buildChartLines(POINTS, null, '', true);

    expect(lines.map(l => l.key)).toEqual(['total', 'stocks']);
    // Totaal: geen stortingen in het bereik, 1000 → 1060.
    expect(lines[0].data[2]).toBeCloseTo(6, 10);
    // Aandelen: dag 2 de aankoop van 600 (geen rendement); dag 3 +60 op 600 + 200 ingebracht.
    expect(lines[1].data[1]).toBeCloseTo(0, 10);
    expect(lines[1].data[2]).toBeCloseTo(7.5, 10);
  });
});

describe('buildChartLines met selectie', () => {
  it('telt de geselecteerde tickers op uit by_ticker, met het label van de selectie', () => {
    const lines = buildChartLines(POINTS, ['AAA', 'BBB'], '2 tickers', false);

    expect(lines.map(l => [l.key, l.label])).toEqual([
      ['selection', '2 tickers'],
      ['selectionInvested', 'Geïnvesteerd'],
    ]);
    expect(lines[0].data).toEqual([0, 600, 860]);
    expect(lines[1].data).toEqual([0, 600, 800]);
  });

  it('telt een ticker die nog niet in een punt staat als 0', () => {
    const lines = buildChartLines(POINTS, ['BBB'], 'BBB', false);

    expect(lines[0].data).toEqual([0, 0, 200]);
    expect(lines[1].data).toEqual([0, 0, 200]);
  });

  it('rekent in % het rendement van de selectie en laat Geïnvesteerd weg', () => {
    const lines = buildChartLines(POINTS, ['AAA'], 'AAA', true);

    expect(lines.map(l => l.key)).toEqual(['selection']);
    expect(lines[0].data[1]).toBeCloseTo(0, 10);
    expect(lines[0].data[2]).toBeCloseTo(10, 10);
  });

  it('begint een selectie die pas in het bereik gekocht wordt op 0 %, zonder NaN', () => {
    const lines = buildChartLines(POINTS, ['BBB'], 'BBB', true);

    expect(lines[0].data.every(Number.isFinite)).toBeTrue();
    expect(lines[0].data).toEqual([0, 0, 0]);
  });
});

describe('hasSelectionData', () => {
  it('is altijd waar zonder selectie', () => {
    expect(hasSelectionData(POINTS, null)).toBeTrue();
  });

  it('is waar als de selectie iets bezat in het bereik', () => {
    expect(hasSelectionData(POINTS, ['AAA'])).toBeTrue();
  });

  it('is onwaar als de selectie vóór het bereik al volledig verkocht was', () => {
    const sold = [
      point('2026-03-02', { by_ticker: { AAA: { value: 0, invested: -200 } } }),
      point('2026-03-03', { by_ticker: { AAA: { value: 0, invested: -200 } } }),
    ];

    expect(hasSelectionData(sold, ['AAA'])).toBeFalse();
  });

  it('is onwaar voor een ticker die nergens in het bereik voorkomt', () => {
    expect(hasSelectionData(POINTS, ['ZZZ'])).toBeFalse();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless --include src/app/utils/chart-lines.spec.ts`
Expected: FAIL — build error `Cannot find module './chart-lines'`.

- [ ] **Step 3: Implement**

Create `frontend/src/app/utils/chart-lines.ts`:

```ts
/**
 * Welke lijnen de portefeuillegrafiek tekent, los van Chart.js.
 *
 * Zonder selectie: Totaal, Aandelen en Netto stortingen. Met een tickerselectie: de waarde
 * van die tickers samen en wat erin geïnvesteerd is. In %-weergave het tijdgewogen
 * rendement (zie returns.ts); lijnen die geld-in tonen in plaats van rendement (stortingen,
 * geïnvesteerd) vallen dan weg — zij hebben geen rendement van zichzelf.
 */
import type { PortfolioPoint } from '../models';
import { timeWeightedReturns } from './returns';

export type ChartLineKey = 'total' | 'stocks' | 'deposits' | 'selection' | 'selectionInvested';

export interface ChartLine {
  key: ChartLineKey;
  label: string;
  data: number[];
}

/** Lopend totaal → stroom per periode (verschil met het vorige punt); de eerste is 0. */
function stepFlows(cumulative: number[]): number[] {
  return cumulative.map((c, i) => (i === 0 ? 0 : c - cumulative[i - 1]));
}

/** € → de waarden zelf; % → tijdgewogen rendement met de stappen van `cumulativeFlows`. */
function series(values: number[], cumulativeFlows: number[], percent: boolean): number[] {
  return percent ? timeWeightedReturns(values, stepFlows(cumulativeFlows)) : values;
}

/** Som over de geselecteerde tickers; een ticker die nog niet in het punt staat telt als 0. */
function sumSelection(
  points: PortfolioPoint[],
  selection: string[],
  field: 'value' | 'invested',
): number[] {
  return points.map(p => selection.reduce((sum, t) => sum + (p.by_ticker[t]?.[field] ?? 0), 0));
}

export function buildChartLines(
  points: PortfolioPoint[],
  selection: string[] | null,
  selectionLabel: string,
  percent: boolean,
): ChartLine[] {
  if (selection === null) {
    const netDeposits = points.map(p => p.net_deposits);
    // Netto belegd in aandelen (aankopen − verkopen, kosten inbegrepen: een aankoopkost is
    // dus een klein verlies). Totaal: enkel stortingen en opnames brengen geld binnen of
    // buiten; trades verschuiven het alleen tussen cash en aandelen.
    const invested = points.map(p => p.net_deposits - p.cash);
    const lines: ChartLine[] = [
      {
        key: 'total',
        label: 'Totaal',
        data: series(points.map(p => p.total), netDeposits, percent),
      },
      {
        key: 'stocks',
        label: 'Aandelen',
        data: series(points.map(p => p.market_value), invested, percent),
      },
    ];
    if (!percent) lines.push({ key: 'deposits', label: 'Netto stortingen', data: netDeposits });
    return lines;
  }

  const value = sumSelection(points, selection, 'value');
  const invested = sumSelection(points, selection, 'invested');
  const lines: ChartLine[] = [
    { key: 'selection', label: selectionLabel, data: series(value, invested, percent) },
  ];
  if (!percent) lines.push({ key: 'selectionInvested', label: 'Geïnvesteerd', data: invested });
  return lines;
}

/** Bezat de selectie iets in deze punten? Zo niet (alles verkocht vóór het bereik, of pas
 *  later gekocht), dan toont het dashboard een melding in plaats van een vlakke nullijn. */
export function hasSelectionData(points: PortfolioPoint[], selection: string[] | null): boolean {
  if (selection === null) return true;
  const value = sumSelection(points, selection, 'value');
  const invested = sumSelection(points, selection, 'invested');
  return value.some(v => v !== 0) || invested.some(v => v !== invested[0]);
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless --include src/app/utils/chart-lines.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/daan/trade-app
git add frontend/src/app/utils/chart-lines.ts frontend/src/app/utils/chart-lines.spec.ts
git commit -m "wip(#4): chart lines for all tickers or a selection"
```

---

### Task 5: Chart component draws the lines it is given

**Files:**
- Modify: `frontend/src/app/shared/price-chart/portfolio-chart.component.ts`
- Test: `frontend/src/app/shared/price-chart/portfolio-chart.component.spec.ts` (new — first component spec in the repo)

**Interfaces:**
- Consumes: `buildChartLines`, `ChartLine`, `ChartLineKey` (Task 4).
- Produces: `PortfolioChartComponent` inputs `selection = input<string[] | null>(null)` and `selectionLabel = input<string>('')` (alongside the existing `data`, `currency`, `mode`).

- [ ] **Step 1: Write the failing component spec**

Create `frontend/src/app/shared/price-chart/portfolio-chart.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import type { Chart } from 'chart.js';
import type { PortfolioPoint } from '../../models';
import { PortfolioChartComponent } from './portfolio-chart.component';

function point(date: string, fields: Partial<PortfolioPoint> = {}): PortfolioPoint {
  return { date, market_value: 0, cash: 0, total: 0, net_deposits: 0, by_ticker: {}, ...fields };
}

const POINTS: PortfolioPoint[] = [
  point('2026-01-05', {
    market_value: 600,
    cash: 400,
    total: 1000,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 600, invested: 600 } },
  }),
  point('2026-01-06', {
    market_value: 660,
    cash: 400,
    total: 1060,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 660, invested: 600 } },
  }),
];

describe('PortfolioChartComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [PortfolioChartComponent] }));

  it('wisselt tussen alle tickers, een selectie en % zonder achtergebleven lijnen', () => {
    const fixture = TestBed.createComponent(PortfolioChartComponent);
    const labels = () =>
      (fixture.componentInstance as unknown as { chart: Chart }).chart.data.datasets.map(
        d => d.label,
      );
    fixture.componentRef.setInput('data', POINTS);
    fixture.detectChanges();
    expect(labels()).toEqual(['Totaal', 'Aandelen', 'Netto stortingen']);

    fixture.componentRef.setInput('selection', ['AAA']);
    fixture.componentRef.setInput('selectionLabel', 'AAA');
    fixture.detectChanges();
    expect(labels()).toEqual(['AAA', 'Geïnvesteerd']);

    fixture.componentRef.setInput('mode', 'percent');
    fixture.detectChanges();
    expect(labels()).toEqual(['AAA']);

    fixture.componentRef.setInput('selection', null);
    fixture.detectChanges();
    expect(labels()).toEqual(['Totaal', 'Aandelen']);
  });
});
```

(If the effect doesn't re-render after `setInput` + `detectChanges()`, add `TestBed.tick();` after each `detectChanges()` — Angular ≥ 20 flushes root effects there.)

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless --include src/app/shared/price-chart/portfolio-chart.component.spec.ts`
Expected: FAIL — `setInput` on unknown input `selection` (NG0303) or labels still `['Totaal', 'Aandelen', 'Netto stortingen']` after selecting.

- [ ] **Step 3: Implement — imports and line styles**

In `frontend/src/app/shared/price-chart/portfolio-chart.component.ts`:

Add `ChartDataset,` to the `chart.js` import list (alphabetically after `ChartConfiguration,`).

Replace
```ts
import { timeWeightedReturns } from '../../utils/returns';
```
with
```ts
import { buildChartLines, type ChartLine, type ChartLineKey } from '../../utils/chart-lines';
```

After the `Chart.register(...);` call, add:

```ts
const VALUE_FILL: Partial<ChartDataset<'line'>> = {
  borderColor: '#58a6ff',
  backgroundColor: 'rgba(88, 166, 255, 0.15)',
  fill: true,
  tension: 0.2,
  borderWidth: 2,
};
const MONEY_IN: Partial<ChartDataset<'line'>> = {
  borderColor: '#8b949e',
  borderDash: [4, 4],
  fill: false,
  tension: 0,
  borderWidth: 1.5,
};
/** Style per line kind: the value line is blue and filled, money-in lines grey and dashed. */
const LINE_STYLES: Record<ChartLineKey, Partial<ChartDataset<'line'>>> = {
  total: VALUE_FILL,
  selection: VALUE_FILL,
  stocks: { borderColor: '#3fb950', fill: false, tension: 0.2, borderWidth: 1.5 },
  deposits: MONEY_IN,
  selectionInvested: MONEY_IN,
};

function toDataset(line: ChartLine): ChartDataset<'line'> {
  return { ...LINE_STYLES[line.key], label: line.label, data: line.data, pointRadius: 0 };
}
```

- [ ] **Step 4: Implement — inputs, effect, render**

Replace the `mode` doc comment and add the two inputs plus the key tracker; the block from `/**` above `mode = input…` through `private chart?: Chart;` becomes:

```ts
  /**
   * 'value' → absolute money; 'percent' → time-weighted return since the first visible point
   * (deposits and purchases are not counted as gains; money-in lines are dropped).
   */
  mode = input<'value' | 'percent'>('value');
  /** Ticker filter: `null` → the whole portfolio; otherwise the sum of these tickers. */
  selection = input<string[] | null>(null);
  /** Legend label of the selection line — the filter button's text, e.g. "ETF". */
  selectionLabel = input<string>('');

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart<'line'>;
  /** Keys of the lines currently drawn, to tell "same lines, new data" from "other lines". */
  private lineKeys = '';
```

(`Chart<'line'>` instead of `Chart` so `chart.data.datasets = lines.map(toDataset)` type-checks.)

In the constructor's effect, replace
```ts
      // Read mode() so toggling €/% re-renders the existing chart.
      this.mode();
```
with
```ts
      // Read the other inputs so toggling €/% or the ticker filter re-renders the chart.
      this.mode();
      this.selection();
      this.selectionLabel();
```

Replace everything in `render()` from its first line down to and including `const unit = this.timeUnit(points);` plus the following `if (this.chart) { … return; }` block with:

```ts
    const labels = points.map(p => p.date);
    const percent = this.mode() === 'percent';
    const lines = buildChartLines(points, this.selection(), this.selectionLabel(), percent);
    const keys = lines.map(l => l.key).join('|');
    const unit = this.timeUnit(points);

    if (this.chart) {
      this.chart.data.labels = labels;
      if (keys === this.lineKeys) {
        // Same lines, new data (another range, another label): patch in place so the user's
        // legend toggles survive.
        lines.forEach((line, i) => {
          const dataset = this.chart!.data.datasets[i];
          dataset.data = line.data;
          dataset.label = line.label;
        });
      } else {
        // Other lines (filter on/off, a money-in line in or out with €/%): replace them all.
        this.chart.data.datasets = lines.map(toDataset);
      }
      this.lineKeys = keys;
      (this.chart.options.scales!['x'] as { time: { unit: string } }).time.unit = unit;
      this.chart.update();
      return;
    }
```

Right after `if (!ctx) return;` add:

```ts
    this.lineKeys = keys;
```

In `config.data`, replace the whole `datasets: [ { label: 'Totaal', … }, { label: 'Aandelen', … }, { label: 'Netto stortingen', … } ],` array with:

```ts
        datasets: lines.map(toDataset),
```

In the legend options, replace
```ts
            labels: {
              color: '#c9d1d9',
              usePointStyle: true,
              boxWidth: 12,
              // Read at every update, so toggling €/% adds or drops "Netto stortingen" (index 2).
              filter: (item) => this.mode() !== 'percent' || item.datasetIndex !== 2,
            },
```
with
```ts
            labels: { color: '#c9d1d9', usePointStyle: true, boxWidth: 12 },
```

Delete the private `series()` method and its doc comment (its logic now lives in `chart-lines.ts`). Leave `timeUnit`, `formatMoney`, `formatPercent`, the scales and the tooltip untouched.

- [ ] **Step 5: Run all frontend specs and the build**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless && npx ng build`
Expected: all specs PASS; build succeeds (only the pre-existing bundle-budget warning).

- [ ] **Step 6: Commit**

```bash
cd /home/daan/trade-app
git add frontend/src/app/shared/price-chart/portfolio-chart.component.ts frontend/src/app/shared/price-chart/portfolio-chart.component.spec.ts
git commit -m "wip(#4): chart draws all tickers or a selection"
```

---

### Task 6: Filter dropdown + dashboard wiring

**Files:**
- Create: `frontend/src/app/shared/ticker-filter/ticker-filter.component.ts`
- Create: `frontend/src/app/shared/ticker-filter/ticker-filter.component.html`
- Modify: `frontend/src/app/pages/dashboard/dashboard.component.ts`
- Modify: `frontend/src/app/pages/dashboard/dashboard.component.html` (chart card, ~lines 254–320)

**Interfaces:**
- Consumes: `buildTickerGroups`, `parseSelection`, `selectionLabel`, `serializeSelection`, `sameTickers`, `toggleTicker`, `TickerGroup`, `TickerGroupRow` (Task 3); `hasSelectionData` (Task 4); chart inputs `selection` / `selectionLabel` (Task 5); `persistedString` from `frontend/src/app/utils/storage.ts`.
- Produces: `<app-ticker-filter [positions] [groups] [selection] [label] (selectionChange)>`; dashboard members `chartTickers`, `tickerGroups`, `chartSelection`, `chartSelectionLabel`, `chartHasData`, `setChartSelection()`.

- [ ] **Step 1: Create the filter component**

Create `frontend/src/app/shared/ticker-filter/ticker-filter.component.ts`:

```ts
import { Component, input, output } from '@angular/core';
import type { PositionMetrics } from '../../models';
import {
  sameTickers,
  toggleTicker,
  type TickerGroup,
  type TickerGroupRow,
} from '../../utils/ticker-groups';

/**
 * Tickerfilter van de portefeuillegrafiek: snelkeuzes per groep en een vinkje per ticker.
 * Houdt zelf geen staat bij — het dashboard bewaart de selectie en geeft ze terug.
 */
@Component({
  selector: 'app-ticker-filter',
  standalone: true,
  templateUrl: './ticker-filter.component.html',
})
export class TickerFilterComponent {
  positions = input.required<PositionMetrics[]>();
  groups = input.required<TickerGroupRow[]>();
  /** `null` = alle tickers. */
  selection = input<string[] | null>(null);
  label = input.required<string>();
  selectionChange = output<string[] | null>();

  isActive(group: TickerGroup): boolean {
    return sameTickers(group.tickers, this.selection());
  }

  isChecked(ticker: string): boolean {
    return this.selection()?.includes(ticker) ?? false;
  }

  pickAll(): void {
    this.selectionChange.emit(null);
  }

  /** Een groep vervangt de selectie; daarna kan je losse tickers nog aan- of afvinken. */
  pickGroup(group: TickerGroup): void {
    this.selectionChange.emit([...group.tickers]);
  }

  toggle(ticker: string): void {
    this.selectionChange.emit(toggleTicker(this.selection(), ticker));
  }
}
```

Create `frontend/src/app/shared/ticker-filter/ticker-filter.component.html` (Bootstrap's dropdown JS is already loaded via `bootstrap.bundle.min.js`; `data-bs-auto-close="outside"` keeps the menu open while ticking):

```html
<div class="dropdown">
  <button
    type="button"
    class="btn btn-sm btn-outline-secondary dropdown-toggle"
    data-bs-toggle="dropdown"
    data-bs-auto-close="outside"
    aria-expanded="false"
  >
    <i class="bi bi-funnel me-1"></i>{{ label() }}
  </button>
  <div class="dropdown-menu p-2" style="min-width: 18rem">
    <button
      type="button"
      class="btn btn-sm btn-outline-secondary mb-2"
      [class.active]="selection() === null"
      (click)="pickAll()"
    >
      Alle
    </button>
    @for (row of groups(); track row.key) {
      <div class="mb-2">
        <div class="text-muted small mb-1">{{ row.label }}</div>
        <div class="d-flex flex-wrap gap-1">
          @for (group of row.groups; track group.key) {
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              [class.active]="isActive(group)"
              (click)="pickGroup(group)"
            >
              {{ group.label }}
            </button>
          }
        </div>
      </div>
    }
    <hr class="dropdown-divider" />
    <div style="max-height: 40vh; overflow-y: auto">
      @for (p of positions(); track p.ticker) {
        <div class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            [id]="'ticker-filter-' + p.ticker"
            [checked]="isChecked(p.ticker)"
            (change)="toggle(p.ticker)"
          />
          <label class="form-check-label" [for]="'ticker-filter-' + p.ticker">
            {{ p.ticker }}
            @if (p.name) {
              <span class="text-muted small ms-1">{{ p.name }}</span>
            }
          </label>
        </div>
      }
    </div>
  </div>
</div>
```

- [ ] **Step 2: Wire the dashboard state**

In `frontend/src/app/pages/dashboard/dashboard.component.ts`:

Add imports:
```ts
import { TickerFilterComponent } from '../../shared/ticker-filter/ticker-filter.component';
import { hasSelectionData } from '../../utils/chart-lines';
import {
  buildTickerGroups,
  parseSelection,
  selectionLabel,
  serializeSelection,
} from '../../utils/ticker-groups';
```

Add `TickerFilterComponent` to the component's `imports` array (after `AllocationChartComponent`).

Directly after the `visibleHistory = computed<PortfolioPoint[]>(…);` block, add:

```ts
  /** Tickerfilter van de grafiek, bewaard als 'AMD,NVDA' ('' = alle tickers). Werkt enkel op
   *  de grafiek; kaarten, allocatie en positietabel blijven over de hele portefeuille gaan. */
  chartTickers = persistedString<string>('chart.tickers', '');

  /** Snelkeuzes (status, type, valuta) uit de posities — geen extra API-call. */
  tickerGroups = computed(() => buildTickerGroups(this.data()?.positions ?? []));

  /** De bewaarde selectie, beperkt tot tickers die nog bestaan; `null` = alle tickers. */
  chartSelection = computed(() =>
    parseSelection(this.chartTickers(), this.data()?.positions ?? []),
  );

  chartSelectionLabel = computed(() => selectionLabel(this.chartSelection(), this.tickerGroups()));

  /** Bezat de selectie iets in het zichtbare bereik? Zo niet: een melding i.p.v. een nullijn. */
  chartHasData = computed(() => hasSelectionData(this.visibleHistory(), this.chartSelection()));

  setChartSelection(selection: string[] | null): void {
    this.chartTickers.set(serializeSelection(selection));
  }
```

- [ ] **Step 3: Wire the dashboard template**

In `frontend/src/app/pages/dashboard/dashboard.component.html`, in the chart controls row, insert the filter between the custom-range `@if (range() === "CUSTOM") { … }` block and the `<div class="btn-group btn-group-sm ms-auto" … aria-label="Weergave">`:

```html
        <app-ticker-filter
          [positions]="d.positions"
          [groups]="tickerGroups()"
          [selection]="chartSelection()"
          [label]="chartSelectionLabel()"
          (selectionChange)="setChartSelection($event)"
        />
```

Replace
```html
      @if (visibleHistory().length === 0) {
        <div class="text-muted small">Geen data in dit bereik.</div>
      } @else {
        <app-portfolio-chart
          [data]="visibleHistory()"
          [currency]="d.totals.display_currency"
          [mode]="valueMode()"
        />
      }
```
with
```html
      @if (visibleHistory().length === 0) {
        <div class="text-muted small">Geen data in dit bereik.</div>
      } @else if (!chartHasData()) {
        <div class="text-muted small">Deze selectie had geen posities in dit bereik.</div>
      } @else {
        <app-portfolio-chart
          [data]="visibleHistory()"
          [currency]="d.totals.display_currency"
          [mode]="valueMode()"
          [selection]="chartSelection()"
          [selectionLabel]="chartSelectionLabel()"
        />
      }
```

- [ ] **Step 4: Run all frontend specs and the build**

Run: `cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless && npx ng build`
Expected: all specs PASS; build succeeds.

- [ ] **Step 5: Check it in the running app**

Start backend (`cd /home/daan/trade-app/backend && npm run dev`) and frontend (`cd /home/daan/trade-app/frontend && npm start`), open the dashboard and verify, with the real data:
- The filter button reads "Alle tickers"; the chart is unchanged (Totaal, Aandelen, Netto stortingen).
- The menu stays open while ticking; "ETF" selects exactly the ETFs, button and legend read "ETF", lines are "ETF" + "Geïnvesteerd".
- Ticking one more ticker changes the label to "`n` tickers"; unticking all returns to "Alle tickers".
- `%` with a selection shows only the selection line; back to `€` brings "Geïnvesteerd" back.
- Changing the range with a selection active keeps the selection; a range before any of the selected tickers was bought shows "Deze selectie had geen posities in dit bereik."
- Reload: the selection is remembered. Cards, allocation and positions table never change with the filter.

- [ ] **Step 6: Commit**

```bash
cd /home/daan/trade-app
git add frontend/src/app/shared/ticker-filter frontend/src/app/pages/dashboard/dashboard.component.ts frontend/src/app/pages/dashboard/dashboard.component.html
git commit -m "wip(#4): ticker filter dropdown on the dashboard chart"
```

---

### Task 7: Docs, full verification, single commit

**Files:**
- Modify: `CLAUDE.md`
- Include: `docs/superpowers/specs/2026-10-15-chart-ticker-filter-design.md`, `docs/superpowers/plans/2026-10-15-chart-ticker-filter.md`

**Interfaces:**
- Consumes: everything above.
- Produces: one commit on `main` on top of `220d08b`.

- [ ] **Step 1: Update `CLAUDE.md`**

In the frontend file-structure block, after the `utils/allocation.ts` line add:

```
  utils/returns.ts              — timeWeightedReturns(): the chart's % mode (inflows count from the start of a period, outflows at its end)
  utils/chart-lines.ts          — buildChartLines(): which lines the portfolio chart draws (all vs. a ticker selection, € vs. %); hasSelectionData()
  utils/ticker-groups.ts        — ticker-filter groups (status / type / quote currency), selection label, toggle, (de)serialize
```

In the `shared/` list, after the `price-chart/allocation-chart.component.ts` line add:

```
    ticker-filter/                 — dropdown: group shortcuts + per-ticker checkboxes for the portfolio chart
```

Change the `pages/dashboard/` line's description to end with `+ portfolio chart (ticker filter) + positions table`.

In "API endpoints", replace the `/api/positions/history` line with:

```
- `GET    /api/positions/history` — daily portfolio value time-series (uses Yahoo historical chart); each point carries `by_ticker: { [ticker]: { value, invested } }` (display currency, from the ticker's first trade) for the chart's ticker filter
```

In "Core domain logic", after the "Day P&L" section add:

```markdown
### Portfolio chart (portfolioHistory.ts + chart-lines.ts)

- **% mode is time-weighted return** (`utils/returns.ts`), not a rebase on the first point: new money (a deposit for "Totaal", a buy for "Aandelen") never shows as a gain. Inflows count from the start of a period, outflows at its end — otherwise a full sell-out reads as −100 %. Money-in lines (Netto stortingen, Geïnvesteerd) are dropped in %.
- **Ticker filter**: every history point carries `by_ticker` — per ticker its value and net invested amount (buys − sells, fees included), present from its first trade, `value` 0 and `invested` frozen after a sell-out. Invariants: `Σ value = market_value`, `Σ invested = net_deposits − cash`. The frontend sums the selection; no request per click.
- Groups (status, type from `PositionMetrics.quote_type`, **quote** currency) are shortcuts that replace the selection. The selection is remembered in localStorage (`chart.tickers`) and only affects the chart — cards, allocation and positions table always cover the whole portfolio.
```

- [ ] **Step 2: Full verification**

Run:
```bash
cd /home/daan/trade-app/backend && npm test && npx tsc --noEmit
cd /home/daan/trade-app/frontend && CHROME_BIN=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1) npx ng test --watch=false --browsers=ChromeHeadless && npx ng build
cd /home/daan/trade-app && npm run check:deps
```
Expected: all backend and frontend tests PASS, no type errors, frontend build succeeds (only the pre-existing budget warning), dependency parity OK.

- [ ] **Step 3: Squash into one commit**

Check that only this plan's `wip(#4)` commits sit on top of `220d08b` and nothing is pushed:

```bash
cd /home/daan/trade-app
git log --oneline 220d08b..HEAD
git log --oneline origin/main..HEAD
```

Then:

```bash
git reset --soft 220d08b
git add CLAUDE.md docs/superpowers/specs/2026-10-15-chart-ticker-filter-design.md docs/superpowers/plans/2026-10-15-chart-ticker-filter.md
git status --short
git commit -F - <<'EOF'
Filter the portfolio chart by ticker, type or currency (Close #4)

A dropdown above the chart picks which tickers it shows: one by one, or
via shortcuts per status (open/closed), instrument type and quote
currency. With a selection the chart shows that selection's value and
the net amount invested in it, in € or as time-weighted return in %.

The history endpoint now returns each ticker's value and net invested
amount per day, so the frontend sums any selection without a new
request. Positions carry their instrument type. The selection is
remembered and only affects the chart.
EOF
git log --oneline -3
```

Expected: `git status --short` before the commit lists every changed file as staged and nothing unstaged; afterwards `main` shows the new commit on top of `220d08b`. Do not push.
