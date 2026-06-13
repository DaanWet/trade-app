# Design: Currency support (TWD/KRW) — issue #8

**Date:** 2026-06-13
**Issue:** [#8 "Currency"](https://github.com/DaanWet/trade-app/issues/8)

## Problem

A user holding Taiwanese/Korean stocks reported two things:

1. The currency picker in the trade- and cash-forms offers only 7 currencies
   (`EUR, USD, GBP, CHF, JPY, CAD, AUD`). Currencies they need — **TWD, KRW** —
   are missing.
2. Because TWD was unavailable, they booked a Taiwan trade in **USD**, but the
   position still shows its value in **TWD** ("de waarde bekijkt hij nog steeds
   in TWD dus da werkt nie").

### Root causes found during exploration

- **Limited, duplicated currency list.** The selectable list lives in two
  hardcoded places that have drifted into duplicates: `COMMON_CURRENCIES` in
  `frontend/src/app/utils/format.ts` (used by trade-form and cash-form) and a
  separate `CURRENCIES` const in
  `frontend/src/app/pages/settings/settings.component.ts`.
- **Quote currency ≠ trade currency.** `current_price` / `market_value` come
  from the Yahoo quote in the stock's **native** currency (TWD for a
  Taiwan-listed ticker), while `state.currency` is the **trade** currency the
  user entered (USD). `positionsCalc.ts` then converts the TWD-denominated
  market value as if it were USD — a genuine mismatch. The trade-form's
  auto-fill (`trade-form.component.ts:167`) actually sets the currency to the
  quote currency (TWD), but TWD isn't in the dropdown, so the `<select>` ends
  up in a broken state and the user overrode it to USD.
- **FX provider gap.** The default FX provider is Frankfurter (ECB reference
  rates). ECB covers **KRW but not TWD**. Since `convert()` is non-throwing, a
  TWD→EUR conversion silently falls back to the *unconverted* amount — so even
  the value math is wrong for TWD.

## Decisions (from brainstorming)

- **Booking currency:** the user will book trades in the stock's **native
  currency** (TWD/KRW), matching the Yahoo quote. USD was only a workaround for
  the missing TWD option. This makes trade currency == quote currency, which
  sidesteps the quote-vs-trade mismatch entirely.
- **Currency list breadth:** a **broad fixed list** — all 30 ECB currencies
  (all correctly convertible via Frankfurter) **plus TWD** (convertible via a
  Yahoo fallback). One-time fix that covers virtually every currency a Yahoo
  listing uses.
- **FX fallback approach:** a **composite FX provider** (Frankfurter primary,
  Yahoo fallback). Chosen over inlining the fallback in `fxService` (couples the
  service to two concrete providers, needed in two methods) and over per-currency
  routing (must maintain an ECB currency list — brittle).

## Design

### 1. Currency list (frontend)

- Expand `COMMON_CURRENCIES` in `frontend/src/app/utils/format.ts` to the 30 ECB
  currencies **+ TWD** (31 total). Order: `EUR`, `USD` pinned first, the rest
  alphabetical.
  - ECB set (from `https://api.frankfurter.dev/v1/currencies`): AUD, BRL, CAD,
    CHF, CNY, CZK, DKK, EUR, GBP, HKD, HUF, IDR, ILS, INR, ISK, JPY, KRW, MXN,
    MYR, NOK, NZD, PHP, PLN, RON, SEK, SGD, THB, TRY, USD, ZAR. Plus **TWD**.
- Delete the duplicate `CURRENCIES` const in
  `frontend/src/app/pages/settings/settings.component.ts` and import
  `COMMON_CURRENCIES` instead → single source of truth. Trade-form and cash-form
  already consume `COMMON_CURRENCIES`, so they inherit the new list for free.

### 2. FX fallback (backend)

- New file `backend/src/services/providers/compositeFx.ts`:
  `makeCompositeFx(primary: FxProvider, fallback: FxProvider): FxProvider`.
  - `fetchRate(base, quote, date)`: return `primary.fetchRate(...)`; if it
    resolves to `null`, return `fallback.fetchRate(...)`.
  - `fetchRange(base, quote, from, to)`: return `primary.fetchRange(...)`; if it
    resolves to an empty array, return `fallback.fetchRange(...)`.
  - `name`: `` `${primary.name}+${fallback.name}` `` (e.g. `frankfurter+yahoo`).
- In `backend/src/services/providers/index.ts`, set
  `fxProvider = makeCompositeFx(frankfurterProvider, yahooFxProvider)`.
- Result: KRW (and all ECB currencies) continue to resolve via Frankfurter; TWD
  falls through to Yahoo's `TWDEUR=X`. `fxService.ts` and everything downstream
  (positions, cash, portfolio history, tax) are unchanged — they keep calling
  `fxProvider.fetchRate` / `.fetchRange`.

### 3. Trade-form robustness (small)

- With TWD/KRW now in the list, the quote-currency auto-fill
  (`trade-form.component.ts:167`) lands on a selectable value — the broken
  `<select>` state is resolved for the reported case.
- Safety net for any *other* exotic currency a quote might return that still
  isn't in the list: if `form().currency` is not present in `COMMON_CURRENCIES`,
  render it as an extra `<option>` so the `<select>` never silently displays a
  different value than what is stored. Keeps the stored value and the visible
  selection in sync. (Applies to the trade-form currency select.)

### 4. Testing

- **Backend (new):** `backend/src/services/providers/compositeFx.test.ts`
  (vitest), using stub `FxProvider`s:
  - `fetchRate`: primary returns a number → that value, fallback not called;
    primary returns `null` → fallback's value; both `null` → `null`.
  - `fetchRange`: primary returns points → those; primary returns `[]` →
    fallback's points; both empty → `[]`.
- **Backend (regression):** existing suite (`positionsCalc`, `cashService`,
  `portfolioHistory`, routes, …) must stay green — the composite is a drop-in
  `FxProvider`.
- **Frontend:** no new automated test (no existing test pattern for these
  components); the list change is data. Verify manually that the dropdowns show
  the new currencies and that a TWD position converts to EUR.

## Out of scope (explicit)

- **Quote currency ≠ trade currency.** Booking a TWD-listed stock in USD (or any
  currency differing from its Yahoo quote currency) is **not** corrected — the
  user books native. Known limitation: if trade currency differs from the
  stock's quote currency, the market value will be wrong. The change nudges
  toward native booking (auto-fill now lands on a valid option; TWD/KRW
  available).
- **Existing data.** The user's existing Taiwan trade currently stored as USD
  must be **edited once to TWD** to correct that row. No migration is performed.
- **Provider configuration via env/settings.** The provider registry stays
  code-configured, as today.
