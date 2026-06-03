import { allRealizedLots, type RealizedLot } from './positionsCalc';
import { convert } from './fxService';
import { priceAt } from './marketData';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';

/**
 * Belgian capital gains tax ("meerwaardebelasting") — applied to realized gains
 * on financial assets from 2026 onwards.
 *
 * Rules implemented:
 *  - For assets bought BEFORE 2026, the "fotomoment" (close on 31/12/2025) acts as
 *    the fiscal cost basis when it is higher than the purchase price; the actual
 *    purchase price may be invoked as a shield, but never to create a deductible
 *    loss. See `applyFotomoment` for the full per-lot decision table.
 *  - Realized losses of the SAME calendar year are netted against gains before the
 *    annual exemption is applied (no carry-over between years).
 *  - The remaining net gain above the exemption is taxed at the rate.
 *  - Amounts are converted to the display currency on the SELL date.
 *
 * Defaults: rate 10%, exemption €10.000/year, applies from 2026 (parameterizable).
 */

export interface TaxParams {
  rate: number;           // e.g. 0.10
  exemption: number;      // annual tax-free threshold in display currency
  appliesFrom: number;    // earliest tax year (e.g. 2026)
  fotomomentDate: string; // snapshot date (last day before appliesFrom), e.g. 2025-12-31
  currency: string;       // currency in which the rules are denominated
}

export const DEFAULT_TAX_PARAMS: TaxParams = {
  rate: 0.10,
  exemption: 10_000,
  appliesFrom: 2026,
  fotomomentDate: '2025-12-31',
  currency: 'EUR',
};

/** Which cost basis produced a lot's taxable result. */
export type TaxBasis = 'none' | 'purchase' | 'fotomoment' | 'shielded';

export interface TaxYearReport {
  year: number;
  gains: number;           // sum of positive taxable lots, in display currency
  losses: number;          // sum of |negative taxable| lots, in display currency
  net_gain_pretax: number; // gains − losses (same-year losses netted)
  exemption: number;
  taxable_amount: number;  // max(0, net_gain_pretax − exemption) when the year applies
  tax_due: number;         // taxable_amount × rate
  rate: number;
  currency: string;
  num_realized_lots: number;
  applies: boolean;        // false if year < appliesFrom (no tax this year)
}

export interface TaxLotDisplay extends RealizedLot {
  year: number;
  taxable: boolean;                       // sell year >= appliesFrom
  cost_basis_display: number;             // P, in display currency
  proceeds_display: number;               // S, in display currency
  realized_pnl_display: number;           // economic P&L: S − P
  fotomoment_value_display: number | null; // F = close(31/12) × shares, null if N/A
  taxable_pnl_display: number;            // fotomoment-adjusted taxable gain/loss
  basis_used: TaxBasis;
}

function yearOf(dateIso: string): number {
  return parseInt(dateIso.slice(0, 4), 10);
}

/**
 * Taxable result for a lot bought before the fotomoment, all amounts in one currency.
 *  - F ≥ P:        taxable = S − F                (fotomoment is the fiscal basis)
 *  - F < P, S ≥ P: taxable = S − P                (real gain above purchase)
 *  - F < P, S ≤ F: taxable = S − F                (deductible loss from the fotomoment)
 *  - F < P, F<S<P: taxable = 0                    (shield: no gain, no deductible loss)
 */
function applyFotomoment(P: number, S: number, F: number): { taxable: number; basis: TaxBasis } {
  if (F >= P) return { taxable: S - F, basis: 'fotomoment' };
  if (S >= P) return { taxable: S - P, basis: 'purchase' };
  if (S <= F) return { taxable: S - F, basis: 'fotomoment' };
  return { taxable: 0, basis: 'shielded' };
}

/**
 * Fetch the fotomoment close (per share) once per ticker that actually needs it:
 * a lot bought before the fotomoment year and sold in a year the tax applies.
 */
async function fetchFotomomentCloses(
  lots: RealizedLot[],
  params: TaxParams,
): Promise<Map<string, { price: number; currency: string | null } | null>> {
  const fotoYear = params.appliesFrom - 1;
  const tickers = new Set<string>();
  for (const l of lots) {
    if (yearOf(l.buy_date) <= fotoYear && yearOf(l.sell_date) >= params.appliesFrom) {
      tickers.add(l.ticker);
    }
  }

  const out = new Map<string, { price: number; currency: string | null } | null>();
  await Promise.all(
    [...tickers].map(async (t) => {
      const r = await priceAt(t, params.fotomomentDate);
      if (!r) {
        console.warn(
          `[tax] No fotomoment price for ${t} on ${params.fotomomentDate}; falling back to purchase basis.`,
        );
        out.set(t, null);
      } else {
        out.set(t, { price: r.price, currency: r.currency });
      }
    }),
  );
  return out;
}

async function enrichLots(
  lots: RealizedLot[],
  displayCurrency: string,
  params: TaxParams,
): Promise<TaxLotDisplay[]> {
  const fotoCloses = await fetchFotomomentCloses(lots, params);
  const fotoYear = params.appliesFrom - 1;

  return Promise.all(
    lots.map(async (l) => {
      const year = yearOf(l.sell_date);
      const taxable = year >= params.appliesFrom;
      const cost_basis_display = await convert(l.cost_basis, l.currency, displayCurrency, l.sell_date);
      const proceeds_display = await convert(l.proceeds, l.currency, displayCurrency, l.sell_date);
      const realized_pnl_display = proceeds_display - cost_basis_display;

      let fotomoment_value_display: number | null = null;
      let taxable_pnl_display: number;
      let basis_used: TaxBasis;

      const foto = fotoCloses.get(l.ticker);
      if (!taxable) {
        // Sold before the tax applies — informational economic P&L only.
        taxable_pnl_display = realized_pnl_display;
        basis_used = 'none';
      } else if (yearOf(l.buy_date) <= fotoYear && foto) {
        const F = await convert(foto.price * l.shares, foto.currency ?? l.currency, displayCurrency, l.sell_date);
        fotomoment_value_display = F;
        const r = applyFotomoment(cost_basis_display, proceeds_display, F);
        taxable_pnl_display = r.taxable;
        basis_used = r.basis;
      } else {
        // Bought in/after the fotomoment year, or no fotomoment price available.
        taxable_pnl_display = realized_pnl_display;
        basis_used = 'purchase';
      }

      return {
        ...l,
        year,
        taxable,
        cost_basis_display,
        proceeds_display,
        realized_pnl_display,
        fotomoment_value_display,
        taxable_pnl_display,
        basis_used,
      };
    }),
  );
}

export async function computeTaxReport(params: TaxParams = DEFAULT_TAX_PARAMS): Promise<TaxYearReport[]> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? params.currency;
  const lots = allRealizedLots();
  if (lots.length === 0) return [];

  const enriched = await enrichLots(lots, displayCurrency, params);

  const byYear = new Map<number, TaxLotDisplay[]>();
  for (const l of enriched) {
    if (!byYear.has(l.year)) byYear.set(l.year, []);
    byYear.get(l.year)!.push(l);
  }

  const report: TaxYearReport[] = [];
  for (const [year, yearLots] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const gains = yearLots.filter(l => l.taxable_pnl_display > 0).reduce((s, l) => s + l.taxable_pnl_display, 0);
    const losses = yearLots.filter(l => l.taxable_pnl_display < 0).reduce((s, l) => s + Math.abs(l.taxable_pnl_display), 0);
    const net = gains - losses;
    const applies = year >= params.appliesFrom;
    const taxable = applies ? Math.max(0, net - params.exemption) : 0;

    report.push({
      year,
      gains,
      losses,
      net_gain_pretax: net,
      exemption: params.exemption,
      taxable_amount: taxable,
      tax_due: taxable * params.rate,
      rate: params.rate,
      currency: displayCurrency,
      num_realized_lots: yearLots.length,
      applies,
    });
  }
  return report;
}

/**
 * Detailed view: every realized lot with its tax-year, display-currency components,
 * fotomoment-adjusted taxable P&L, and which basis was applied.
 */
export async function listRealizedLotsForTax(): Promise<TaxLotDisplay[]> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? DEFAULT_TAX_PARAMS.currency;
  return enrichLots(allRealizedLots(), displayCurrency, DEFAULT_TAX_PARAMS);
}
