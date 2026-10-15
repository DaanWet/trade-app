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
