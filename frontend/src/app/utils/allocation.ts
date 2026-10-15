/**
 * Verdeling van de portefeuille over tickers (en optioneel cash) — voedt de allocatie-taart.
 *
 * Puur afgeleid uit de positions-respons die het dashboard al heeft: geen extra API-call.
 */
import type { PositionMetrics } from '../models';

export const CASH_KEY = '__CASH__';
export const OTHER_KEY = '__OTHER__';

/**
 * Tickerkleuren in vaste volgorde. De volgorde is de kleurenblind-veiligheid, niet cosmetisch:
 * gevalideerd (CVD ΔE ≥ 8, normaal zicht ≥ 15) op de donkere kaart (#161b22) voor elk paar
 * buren, inclusief de naad waar het laatste stuk de donut rond weer het eerste raakt.
 * Groen hoort er bewust niet bij als cashkleur: naast oranje, geel of aqua is het voor
 * kleurenblinden niet te onderscheiden.
 */
const TICKER_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#e66767'];
/** Neutraal: cash is niet belegd. */
const CASH_COLOR = '#8b949e';
/** Donkerder neutraal, zodat het niet met cash verward wordt. */
const OTHER_COLOR = '#484f58';

export interface AllocationSlice {
  /** Ticker, of CASH_KEY / OTHER_KEY. */
  key: string;
  label: string;
  name: string | null;
  /** In de weergavemunt. */
  value: number;
  /** Aandeel in `Allocation.total`, 0–100. */
  pct: number;
  color: string;
}

export interface Allocation {
  /** Wat de taart tekent: hoogstens zoveel tickers als er kleuren zijn, de rest in Overig. */
  slices: AllocationSlice[];
  /** Wat de legenda toont: elke ticker apart (gebundelde in de Overig-kleur), dan cash. */
  rows: AllocationSlice[];
  total: number;
  /** Open posities zonder marktwaarde (geen koers) — weggelaten, want onwaardeerbaar. */
  unpriced: number;
}

/**
 * Tickers krijgen hun kleur op volgorde van marktwaarde, vóór cash erbij komt: de
 * cash-schakelaar herkleurt dus nooit een ticker. Negatieve cash kan geen taartstuk
 * zijn en valt weg, net als in de allocatiebalk.
 */
export function computeAllocation(
  positions: PositionMetrics[],
  cashBalance: number,
  includeCash: boolean
): Allocation {
  const open = positions.filter(p => p.is_open);
  const priced = open
    .filter(p => (p.market_value_display ?? 0) > 0)
    .sort((a, b) => b.market_value_display! - a.market_value_display!);
  const cash = includeCash && cashBalance > 0 ? cashBalance : 0;
  const total = priced.reduce((sum, p) => sum + p.market_value_display!, 0) + cash;
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0);

  const tickerRows: AllocationSlice[] = priced.map((p, i) => ({
    key: p.ticker,
    label: p.ticker,
    name: p.name,
    value: p.market_value_display!,
    pct: pct(p.market_value_display!),
    color: TICKER_COLORS[i] ?? OTHER_COLOR,
  }));
  const cashRows: AllocationSlice[] =
    cash > 0
      ? [{ key: CASH_KEY, label: 'Cash', name: null, value: cash, pct: pct(cash), color: CASH_COLOR }]
      : [];

  const shown = tickerRows.slice(0, TICKER_COLORS.length);
  const folded = tickerRows.slice(TICKER_COLORS.length);
  const other = folded.reduce((sum, r) => sum + r.value, 0);
  const otherSlices: AllocationSlice[] =
    folded.length > 0
      ? [
          {
            key: OTHER_KEY,
            label: `Overig (${folded.length})`,
            name: null,
            value: other,
            pct: pct(other),
            color: OTHER_COLOR,
          },
        ]
      : [];

  return {
    slices: [...shown, ...otherSlices, ...cashRows],
    rows: [...tickerRows, ...cashRows],
    total,
    unpriced: open.length - priced.length,
  };
}
