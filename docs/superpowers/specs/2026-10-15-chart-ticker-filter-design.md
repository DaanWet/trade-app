# Design: Ticker filter for the portfolio chart — issue #4

**Date:** 2026-10-15
**Issue:** [#4 "Improve portfolio Graph"](https://github.com/DaanWet/trade-app/issues/4) — last open item: "Add filter options"

## Problem

The portfolio chart can already pick a time range (7D…Max, custom), switch between € and %
(time-weighted return since `220d08b`), and hide a line by clicking its legend entry. It always
shows the **whole** portfolio, though. There is no way to see how one part of it evolved — the ETFs,
everything quoted in USD, a single position, or the positions you already closed.

The data to answer that is computed already: `buildPortfolioHistory()` values every ticker every
day (`qty × close × fx`) but sums it into one `market_value` straight away
(`backend/src/services/portfolioHistory.ts:139`), and does the same for the trade cash flows that
make up `invested` (`:112`).

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| What does a selection show? | **The sum of the selection**: one line "value of the selection" plus a dashed "Geïnvesteerd" line (net money put into those tickers). Not one line per ticker, not a stacked area. |
| How do groups and tickers relate? | **Groups are shortcuts**: the selection is always a set of tickers; clicking a group replaces the selection with that group's tickers, after which single tickers can still be ticked on/off. One dropdown. |
| Where is the sum computed? | **Approach A**: `/api/positions/history` returns a per-ticker breakdown in every point; the frontend sums. Filtering is instant, no request per click. (Rejected: B — server-side sum per `?tickers=`, a full rebuild per click; C — a separate lazy endpoint, two code paths for no gain at this portfolio size.) |
| Scope of the filter | **Chart only.** Totals cards, allocation and positions table keep covering the whole portfolio (same as the positions filter only affects the table). |
| "Geïnvesteerd" meaning | Net trade cash flow into the selection (buys − sells, fees included) — the per-ticker counterpart of how `net_deposits` relates to the whole. **Not** FIFO cost basis (the issue reporter called that line useless). |
| Currency group | By **quote currency** (`PositionMetrics.quote_currency`) — that is where the FX exposure lives, not in the currency the trade was booked in. |
| Group click | **Replaces** the selection (ETF then USD → only USD). |
| Which groups appear | Only non-empty ones. |
| Persistence | Remembered across visits, like range and €/%. |
| Closed positions | Selectable; their line shows the period they were held. |

## Design

### 1. Backend — per-ticker breakdown in the history

`PortfolioPoint` (backend `portfolioHistory.ts` and frontend `models/index.ts`) gains:

```ts
/** Per ticker, in display currency. Present from the ticker's first trade onwards. */
by_ticker: Record<string, { value: number; invested: number }>;
```

- `value` — that ticker's market value that day: exactly the term the day loop currently adds to
  `mv`. When no close is found (the existing 7-day look-back fails) it is `0`, consistent with
  `mv` skipping it today.
- `invested` — cumulative net trade cash flow for that ticker: exactly the term currently added to
  `invested`, kept per ticker (`tradeCashFlow(t)` converted at `trade_date`).
- A ticker appears in `by_ticker` from the day of its first trade. After a full sell-out it stays,
  with `value: 0` and `invested` frozen at its final result (negative when you took out more than
  you put in). This keeps a selection's lines continuous.
- **Invariants** (per point, up to float rounding):
  - `Σ by_ticker[t].value === market_value`
  - `Σ by_ticker[t].invested === net_deposits − cash`
- The route stays `GET /api/positions/history`; the field is additive, the response is still an
  array of points.

`PositionMetrics` (backend `positionsCalc.ts` and frontend model) gains
`quote_type: string | null`, read from the cached `tickers` row (`getTicker(symbol)?.quote_type`),
the same cache `portfolioHistory` already uses for the quote currency. The frontend builds the
"type" groups from it.

### 2. Frontend — groups (pure)

New `frontend/src/app/utils/ticker-groups.ts`, no Angular dependencies:

- `buildTickerGroups(positions: PositionMetrics[]): TickerGroupRow[]` returns three rows of
  groups, each group `{ key, label, tickers: string[] }`, empty groups left out:
  - **Status**: Open (`is_open`), Gesloten (`!is_open`).
  - **Type** from `quote_type`: `EQUITY` → Aandeel, `ETF` → ETF, `MUTUALFUND` → Fonds,
    `FUTURE` → Future, `CURRENCY` → FX, `CRYPTOCURRENCY` → Crypto, `INDEX` → Index;
    `null` or anything else → Overig. (`CURRENCY` is "FX", not "Valuta", so it can't be
    confused with the currency row below.)
  - **Valuta** from `quote_currency`, one group per currency, sorted alphabetically.
- `selectionLabel(selection: string[] | null, rows: TickerGroupRow[]): string` — the text on the
  filter button and the selection line's legend label:
  - `null` (no filter) → "Alle tickers";
  - one ticker → its symbol (even when it alone forms a group: "NG=F" says more than "Future");
  - exactly one group's ticker set → that group's label (e.g. "ETF"; first match in row order);
  - otherwise → "`n` tickers".
- `sameTickers(a, b)` (set equality, `null` never matches), `toggleTicker(selection, ticker)`,
  `parseSelection(stored, positions)` and `serializeSelection(selection)` keep the selection rules
  in one testable place (see §3 and §4).

### 3. Frontend — filter state

In `DashboardComponent`:

- `chartTickers = persistedString<string>('chart.tickers', '')` — comma-separated symbols; `''`
  means "Alle".
- `chartSelection = computed<string[] | null>()` — parses it and intersects with the tickers in
  `data().positions`. Unknown symbols (trades since deleted) are dropped; an empty result means
  `null` ("Alle").
- Setting the selection writes the sorted, comma-joined symbols back; choosing "Alle" or
  unticking the last ticker writes `''`.

### 4. Frontend — filter dropdown

New standalone `frontend/src/app/shared/ticker-filter/ticker-filter.component.ts`:

- Inputs: `positions: PositionMetrics[]`, `groups: TickerGroupRow[]`, `selection: string[] | null`,
  `label: string` (groups and label are computed once in the dashboard, which also needs the label
  for the chart legend). Output: `selectionChange: string[] | null`. The component keeps no state.
- With "Alle" no checkbox is ticked, so ticking one ticker shows just that ticker; ticking more
  adds to it.
- A Bootstrap dropdown (`data-bs-toggle="dropdown"`, `data-bs-auto-close="outside"` so it stays
  open while ticking; `bootstrap.bundle.min.js` is already loaded). Button text =
  `selectionLabel(...)`.
- Menu content, top to bottom: "Alle"; one row of small buttons per group row (Status, Type,
  Valuta); a divider; one checkbox per ticker showing symbol + name, in the positions' order.
- Group button click → emit that group's tickers (replace). Checkbox toggle → add/remove that
  ticker; removing the last one emits `null`. The active group (selection equals its ticker set)
  is shown as active.
- Placed in the chart's control row in `dashboard.component.html`, between the range buttons and
  the €/% group.

### 5. Frontend — which lines the chart draws (pure)

New `frontend/src/app/utils/chart-lines.ts`, no Angular/Chart.js dependencies:

```ts
type ChartLineKey = 'total' | 'stocks' | 'deposits' | 'selection' | 'selectionInvested';
interface ChartLine { key: ChartLineKey; label: string; data: number[] }

buildChartLines(
  points: PortfolioPoint[],
  selection: string[] | null,
  selectionLabel: string,
  percent: boolean,
): ChartLine[]
```

- `selection === null` → today's lines, today's logic (moved here from
  `PortfolioChartComponent.render()`/`series()`): Totaal (flows Δ`net_deposits`), Aandelen
  (flows Δ(`net_deposits − cash`)), Netto stortingen (dropped in % mode).
- `selection !== null` →
  - `selection` line, label = `selectionLabel`: per point `Σ by_ticker[t]?.value ?? 0`.
  - `selectionInvested` line, label "Geïnvesteerd": per point `Σ by_ticker[t]?.invested ?? 0`;
    dropped in % mode.
  - In % mode the selection line is `timeWeightedReturns(values, Δinvested)`.
- `hasSelectionData(points, selection): boolean` — false when every visible point has a selection
  value of 0 and the invested sum never changes; the dashboard then shows
  "Deze selectie had geen posities in dit bereik." instead of the chart.

`PortfolioChartComponent`:

- New input `selection = input<string[] | null>(null)` and `selectionLabel = input<string>('')`.
- `render()` calls `buildChartLines()` and maps each line's `key` to a style (colours/dash as
  today: `total`/`selection` = blue filled, `stocks` = green, `deposits`/`selectionInvested` =
  grey dashed).
- Because the number and kind of lines changes with the selection, the update path replaces
  `chart.data.datasets` when the set of keys changes, and patches `data`/`label` in place
  otherwise. The legend filter that hides the deposits entry in % mode goes away: lines that
  should not show are simply not returned.

### 6. Testing

- **Backend** (`portfolioHistory.test.ts`, `positionsCalc.test.ts`):
  - the two invariants hold on every point for a multi-ticker, multi-currency fixture;
  - a closed ticker has `value: 0` after its sell-out and an unchanging `invested`;
  - a ticker is absent from `by_ticker` before its first trade;
  - `quote_type` is filled from the tickers cache, `null` when unknown.
- **Frontend** (Karma specs, Dutch descriptions like `allocation.spec.ts`):
  - `ticker-groups.spec.ts`: only non-empty groups; type mapping incl. Overig; currency groups
    use the quote currency; `selectionLabel` cases (Alle, group match, one ticker, n tickers).
  - `chart-lines.spec.ts`: `null` selection reproduces today's lines in € and % (regression for
    the move out of the component); selection sums `value`/`invested`; missing ticker in a point
    counts as 0; % mode drops `selectionInvested` and uses TWR on Δinvested; `hasSelectionData`.
- **Manual**: run the app, pick a group, a single ticker, a closed ticker; toggle €/% and the
  range with a selection active; reload and check the selection is remembered.
- `CLAUDE.md`: document `by_ticker` and `quote_type` in the API/domain sections and the ticker
  filter in the dashboard description.

## Out of scope (explicit)

- One line per ticker or a stacked area per ticker.
- Combinable (AND) filter dimensions, e.g. "ETF and USD".
- Applying the selection to the totals cards, allocation or positions table.
- Filtering by exchange.
- Benchmark/index overlay.
- Making the history payload columnar or lazy-loaded (only worth it at a much larger portfolio).
