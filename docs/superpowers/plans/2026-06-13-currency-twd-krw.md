# TWD/KRW Currency Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record and value trades in any major currency (notably TWD and KRW), with correct FX conversion to the display currency.

**Architecture:** Frontend gets a broad, single-sourced currency list (30 ECB currencies + TWD). Backend gains a composite FX provider that tries Frankfurter (ECB) first and falls back to Yahoo for pairs ECB doesn't publish (e.g. TWD→EUR). The trade-form's currency `<select>` is hardened so it always reflects the stored value.

**Tech Stack:** Node 22 + TypeScript + vitest (backend); Angular 21 standalone components (frontend).

**Spec:** `docs/superpowers/specs/2026-06-13-currency-twd-krw-design.md`

**Branching:** This project uses **trunk-based development** — commit directly on `main`, no feature branches.

---

## File Structure

- **Create:** `backend/src/services/providers/compositeFx.ts` — `makeCompositeFx(primary, fallback)` factory returning a fallback-chaining `FxProvider`.
- **Create:** `backend/src/services/providers/compositeFx.test.ts` — unit tests for the factory.
- **Modify:** `backend/src/services/providers/index.ts` — point `fxProvider` at the composite.
- **Modify:** `frontend/src/app/utils/format.ts` — expand `COMMON_CURRENCIES` to 31 codes.
- **Modify:** `frontend/src/app/pages/settings/settings.component.ts` — drop the duplicate list, import the shared one.
- **Modify:** `frontend/src/app/shared/trade-form/trade-form.component.ts` — add `currencyOptions` computed.
- **Modify:** `frontend/src/app/shared/trade-form/trade-form.component.html` — render `currencyOptions()`.

---

## Task 1: Composite FX provider (backend, TDD)

**Files:**
- Test: `backend/src/services/providers/compositeFx.test.ts`
- Create: `backend/src/services/providers/compositeFx.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/providers/compositeFx.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeCompositeFx } from "./compositeFx";
import type { FxProvider, FxRangePoint } from "./types";

function stub(name: string, rate: number | null, range: FxRangePoint[]): FxProvider {
  return {
    name,
    fetchRate: vi.fn(async () => rate),
    fetchRange: vi.fn(async () => range),
  };
}

const POINTS: FxRangePoint[] = [{ date: "2026-01-02", rate: 0.03 }];

describe("makeCompositeFx", () => {
  it("names itself primary+fallback", () => {
    const c = makeCompositeFx(stub("frankfurter", 1, []), stub("yahoo", 1, []));
    expect(c.name).toBe("frankfurter+yahoo");
  });

  describe("fetchRate", () => {
    it("uses the primary rate and never calls the fallback when primary has data", async () => {
      const primary = stub("p", 0.9, []);
      const fallback = stub("f", 0.5, []);
      const c = makeCompositeFx(primary, fallback);

      await expect(c.fetchRate("USD", "EUR", "2026-01-02")).resolves.toBe(0.9);
      expect(fallback.fetchRate).not.toHaveBeenCalled();
    });

    it("falls back to the secondary rate when primary returns null (e.g. TWD)", async () => {
      const primary = stub("p", null, []);
      const fallback = stub("f", 0.03, []);
      const c = makeCompositeFx(primary, fallback);

      await expect(c.fetchRate("TWD", "EUR", "2026-01-02")).resolves.toBe(0.03);
      expect(fallback.fetchRate).toHaveBeenCalledWith("TWD", "EUR", "2026-01-02");
    });

    it("returns null when neither provider has a rate", async () => {
      const c = makeCompositeFx(stub("p", null, []), stub("f", null, []));
      await expect(c.fetchRate("XXX", "EUR", "2026-01-02")).resolves.toBeNull();
    });
  });

  describe("fetchRange", () => {
    it("uses the primary range and never calls the fallback when primary has points", async () => {
      const primary = stub("p", null, POINTS);
      const fallback = stub("f", null, [{ date: "2026-01-02", rate: 9 }]);
      const c = makeCompositeFx(primary, fallback);

      await expect(c.fetchRange("USD", "EUR", new Date(), new Date())).resolves.toEqual(POINTS);
      expect(fallback.fetchRange).not.toHaveBeenCalled();
    });

    it("falls back to the secondary range when primary is empty", async () => {
      const c = makeCompositeFx(stub("p", null, []), stub("f", null, POINTS));
      await expect(c.fetchRange("TWD", "EUR", new Date(), new Date())).resolves.toEqual(POINTS);
    });

    it("returns an empty array when neither provider has points", async () => {
      const c = makeCompositeFx(stub("p", null, []), stub("f", null, []));
      await expect(c.fetchRange("XXX", "EUR", new Date(), new Date())).resolves.toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/services/providers/compositeFx.test.ts`
Expected: FAIL — `Failed to resolve import "./compositeFx"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `backend/src/services/providers/compositeFx.ts`:

```ts
import type { FxProvider } from "./types";

/**
 * Compose two FxProviders into a fallback chain: try `primary`, and only when it
 * has no data (fetchRate → null, fetchRange → empty) defer to `fallback`.
 *
 * This lets Frankfurter (ECB) serve every currency it publishes while a secondary
 * provider (Yahoo) fills the gaps ECB doesn't cover — most notably TWD, which has
 * no ECB reference rate. The concrete providers already swallow their own transport
 * errors and return null/empty, so a clean "no data" result is the only fallback
 * trigger and nothing here needs a try/catch.
 */
export function makeCompositeFx(primary: FxProvider, fallback: FxProvider): FxProvider {
  return {
    name: `${primary.name}+${fallback.name}`,

    async fetchRate(base, quote, date) {
      const rate = await primary.fetchRate(base, quote, date);
      return rate != null ? rate : fallback.fetchRate(base, quote, date);
    },

    async fetchRange(base, quote, from, to) {
      const points = await primary.fetchRange(base, quote, from, to);
      return points.length > 0 ? points : fallback.fetchRange(base, quote, from, to);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/services/providers/compositeFx.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/providers/compositeFx.ts backend/src/services/providers/compositeFx.test.ts
git commit -m "$(cat <<'EOF'
Add composite FX provider with Frankfurter→Yahoo fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire the composite into the provider registry (backend)

**Files:**
- Modify: `backend/src/services/providers/index.ts`

- [ ] **Step 1: Update the registry**

In `backend/src/services/providers/index.ts`, add the composite import and change the `fxProvider` export.

Add to the imports at the top (alongside the existing provider imports):

```ts
import { makeCompositeFx } from "./compositeFx";
```

Replace this line:

```ts
/** Default FX provider — Frankfurter (ECB), no rate limits, no key. */
export const fxProvider: FxProvider = frankfurterProvider;
```

with:

```ts
/**
 * Default FX provider — Frankfurter (ECB) first, Yahoo as a fallback for pairs
 * ECB doesn't publish (e.g. TWD). Frankfurter has no rate limits and no key;
 * Yahoo is only hit when Frankfurter returns no data.
 */
export const fxProvider: FxProvider = makeCompositeFx(frankfurterProvider, yahooFxProvider);
```

> Note: `frankfurterProvider` and `yahooFxProvider` are already imported in this file. Leave the named re-exports at the bottom untouched.

- [ ] **Step 2: Verify the full backend suite stays green**

Run: `cd backend && npm test`
Expected: PASS — the entire existing suite plus `compositeFx.test.ts`. The composite is a drop-in `FxProvider`, so positions/cash/history/tax tests are unaffected.

- [ ] **Step 3: Verify the backend type-checks**

Run: `cd backend && npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/providers/index.ts
git commit -m "$(cat <<'EOF'
Use composite FX provider so TWD converts via Yahoo fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Expand & unify the currency list (frontend)

**Files:**
- Modify: `frontend/src/app/utils/format.ts`
- Modify: `frontend/src/app/pages/settings/settings.component.ts`

> No automated test: the frontend has no unit-test harness wired for these and the change is data only (per spec). Verification is the Angular build.

- [ ] **Step 1: Expand the shared currency list**

In `frontend/src/app/utils/format.ts`, replace:

```ts
/** Currencies offered in the trade- and cash-form selectors. */
export const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
```

with:

```ts
/** Currencies offered in the trade-/cash-form selectors and the settings display-currency
 *  picker. The full ECB reference set (all convertible via Frankfurter) plus TWD (convertible
 *  via the Yahoo FX fallback). EUR/USD pinned first, the rest alphabetical. */
export const COMMON_CURRENCIES = [
  'EUR',
  'USD',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'ZAR',
];
```

- [ ] **Step 2: Point settings at the shared list**

In `frontend/src/app/pages/settings/settings.component.ts`:

Add the import below the existing `ApiService` import:

```ts
import { COMMON_CURRENCIES } from '../../utils/format';
```

Delete this duplicate constant:

```ts
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
```

Change:

```ts
  readonly currencies = CURRENCIES;
```

to:

```ts
  readonly currencies = COMMON_CURRENCIES;
```

- [ ] **Step 3: Verify the frontend build**

Run: `cd frontend && npm run build`
Expected: `ng build` completes without errors (catches the removed-const reference if anything was missed). Trade-form and cash-form already import `COMMON_CURRENCIES`, so they inherit the new list.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/utils/format.ts frontend/src/app/pages/settings/settings.component.ts
git commit -m "$(cat <<'EOF'
Expand currency list to ECB set + TWD, single-source it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Harden the trade-form currency select (frontend)

**Files:**
- Modify: `frontend/src/app/shared/trade-form/trade-form.component.ts`
- Modify: `frontend/src/app/shared/trade-form/trade-form.component.html`

> Rationale: the price lookup auto-fills `form.currency` from the quote's native currency (`trade-form.component.ts:167`). If that currency isn't in the list, the `<select>` would silently show something other than the stored value. Surface the stored value as an extra option so the select always matches the form.

- [ ] **Step 1: Add the `currencyOptions` computed**

In `frontend/src/app/shared/trade-form/trade-form.component.ts`, replace:

```ts
  readonly sides: TradeSide[] = ['BUY', 'SELL'];
  readonly currencies = COMMON_CURRENCIES;
```

with:

```ts
  readonly sides: TradeSide[] = ['BUY', 'SELL'];

  /** Currency dropdown options. If the form holds a currency outside the standard
   *  list (e.g. an exotic quote currency auto-filled from Yahoo), surface it as an
   *  extra option so the <select> always reflects the stored value. */
  currencyOptions = computed(() => {
    const cur = this.form().currency;
    return COMMON_CURRENCIES.includes(cur) ? COMMON_CURRENCIES : [cur, ...COMMON_CURRENCIES];
  });
```

> `computed` and `COMMON_CURRENCIES` are already imported in this file (lines 1 and 8). No import changes needed.

- [ ] **Step 2: Use `currencyOptions()` in the template**

In `frontend/src/app/shared/trade-form/trade-form.component.html`, change:

```html
        @for (c of currencies; track c) {
          <option [value]="c">{{ c }}</option>
        }
```

to:

```html
        @for (c of currencyOptions(); track c) {
          <option [value]="c">{{ c }}</option>
        }
```

- [ ] **Step 3: Verify the frontend build**

Run: `cd frontend && npm run build`
Expected: `ng build` completes without errors (the removed `currencies` field is no longer referenced anywhere).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/shared/trade-form/trade-form.component.ts frontend/src/app/shared/trade-form/trade-form.component.html
git commit -m "$(cat <<'EOF'
Keep trade-form currency select in sync with stored value

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final verification & data note

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: PASS — all suites green.

- [ ] **Step 2: Manual smoke test** (start backend `npm run dev`, frontend `npm start`)

  - Trade-form, cash-form and settings dropdowns all list the new currencies (incl. TWD, KRW).
  - Add a BUY for a Taiwan-listed ticker (e.g. `2330.TW`): the currency auto-fills to TWD, the price suggestion is in TWD, and the dashboard "Waarde" column shows a sane EUR value (TWD→EUR via the Yahoo fallback — confirm it is not the raw TWD magnitude).
  - Add/confirm a KRW position converts to EUR via Frankfurter as before.

- [ ] **Step 3: Correct the existing mis-booked trade**

The user's existing Taiwan trade is stored in USD. Edit it in the Trades page and set its currency to TWD so its market value lines up with the (TWD) quote. (Manual — no migration.)

---

## Self-Review

- **Spec coverage:**
  - Currency list (ECB + TWD), single-sourced → Task 3. ✔
  - Composite FX provider + registry wiring → Tasks 1, 2. ✔
  - Trade-form select robustness → Task 4. ✔
  - Testing (compositeFx unit + regression suite) → Tasks 1, 2, 5. ✔
  - Out-of-scope items (quote≠trade mismatch, data fix) → documented; data fix surfaced as Task 5 Step 3. ✔
- **Placeholder scan:** none — every code/test step contains full content.
- **Type/name consistency:** `makeCompositeFx(primary, fallback)`, `fetchRate→number|null`, `fetchRange→FxRangePoint[]`, `COMMON_CURRENCIES`, `currencyOptions` used consistently across tasks.
