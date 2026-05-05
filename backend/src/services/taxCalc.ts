import { allRealizedLots, type RealizedLot } from './positionsCalc';
import { convert } from './fxService';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';

/**
 * Belgian capital gains tax ("meerwaardebelasting") — applied to realized gains
 * on financial assets from 2026 onwards.
 *
 * Rules implemented:
 *  - Tax rate applied to net gains above an annual exemption.
 *  - Losses do NOT reduce gains (no loss carry-over). The official rules treat
 *    realized losses as outside the tax base; we expose them separately.
 *  - Gains realized in the same calendar year are summed.
 *  - Gains/losses are converted to the display currency on the SELL date.
 *
 * Defaults: rate 10%, exemption €10.000/year (parameterizable for future tweaks).
 */

export interface TaxParams {
  rate: number;          // e.g. 0.10
  exemption: number;     // annual tax-free threshold in display currency
  appliesFrom: number;   // earliest tax year (e.g. 2026)
  currency: string;      // currency in which the rules are denominated
}

export const DEFAULT_TAX_PARAMS: TaxParams = {
  rate: 0.10,
  exemption: 10_000,
  appliesFrom: 2026,
  currency: 'EUR',
};

export interface TaxYearReport {
  year: number;
  gains: number;          // sum of positive realized lots, in display currency
  losses: number;         // sum of |negative realized| lots, in display currency
  net_gain_pretax: number; // gains (losses are NOT subtracted under BE rules)
  exemption: number;
  taxable_amount: number; // max(0, gains - exemption)
  tax_due: number;        // taxable_amount * rate
  rate: number;
  currency: string;
  num_realized_lots: number;
  applies: boolean;       // false if year < appliesFrom (no tax this year)
}

interface RealizedInDisplay extends RealizedLot {
  realized_pnl_display: number;
  year: number;
}

async function convertLots(lots: RealizedLot[], displayCurrency: string): Promise<RealizedInDisplay[]> {
  return Promise.all(
    lots.map(async (l) => ({
      ...l,
      realized_pnl_display: await convert(l.realized_pnl, l.currency, displayCurrency, l.sell_date),
      year: parseInt(l.sell_date.slice(0, 4), 10),
    }))
  );
}

export async function computeTaxReport(params: TaxParams = DEFAULT_TAX_PARAMS): Promise<TaxYearReport[]> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? params.currency;
  const lots = allRealizedLots();
  if (lots.length === 0) return [];

  const converted = await convertLots(lots, displayCurrency);

  const byYear = new Map<number, RealizedInDisplay[]>();
  for (const l of converted) {
    if (!byYear.has(l.year)) byYear.set(l.year, []);
    byYear.get(l.year)!.push(l);
  }

  const report: TaxYearReport[] = [];
  for (const [year, yearLots] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const gains = yearLots.filter(l => l.realized_pnl_display > 0).reduce((s, l) => s + l.realized_pnl_display, 0);
    const losses = yearLots.filter(l => l.realized_pnl_display < 0).reduce((s, l) => s + Math.abs(l.realized_pnl_display), 0);
    const applies = year >= params.appliesFrom;
    const taxable = applies ? Math.max(0, gains - params.exemption) : 0;

    report.push({
      year,
      gains,
      losses,
      net_gain_pretax: gains - losses,
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
 * Detailed view: every realized lot with its tax-year and display-currency P&L.
 * Useful for a "show me what triggers my tax bill" view.
 */
export async function listRealizedLotsForTax(): Promise<RealizedInDisplay[]> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? 'EUR';
  return convertLots(allRealizedLots(), displayCurrency);
}
