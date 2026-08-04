import { Component, computed, input } from '@angular/core';
import type { PositionMetrics } from '../../models';
import { MoneyPipe, PercentPipe, SharesPipe } from '../number-format/format.pipes';
import { formatDateTime, pnlClass } from '../../utils/format';
import { SortState, compareValues } from '../../utils/sort';

/** Ruimer dan de cache-TTL van 5 minuten aan de serverkant: elk verzoek om posities
 *  ververst koersen die ouder zijn dan die TTL, dus alles wat hier nog steeds oud is,
 *  betekent dat het ophalen bij de provider is mislukt — niet dat de markt dicht is. */
const STALE_AFTER_MS = 15 * 60 * 1000;

@Component({
  selector: 'app-positions-table',
  standalone: true,
  imports: [MoneyPipe, PercentPipe, SharesPipe],
  templateUrl: './positions-table.component.html',
})
export class PositionsTableComponent {
  positions = input.required<PositionMetrics[]>();

  readonly pnlClass = pnlClass;

  // Geen kolom gekozen → backend-standaardvolgorde behouden.
  sort = new SortState(null, 'asc');

  /** Gesorteerde rijen; open posities blijven bovenaan, gesloten onderaan. */
  sorted = computed<PositionMetrics[]>(() => {
    const rows = this.positions();
    const key = this.sort.key();
    if (!key) return rows;
    const dir = this.sort.dir() === 'asc' ? 1 : -1;
    const cmp = (a: PositionMetrics, b: PositionMetrics) =>
      compareValues(this.posValue(a, key), this.posValue(b, key)) * dir;
    const open = rows.filter(p => p.is_open).sort(cmp);
    const closed = rows.filter(p => !p.is_open).sort(cmp);
    return [...open, ...closed];
  });

  /** Tickers waarvan de getoonde koers niet meer ververst wordt. Zonder dit signaal is een
   *  bevroren koers niet te onderscheiden van een actuele — precies hoe een provider-storing
   *  wekenlang onopgemerkt kan blijven. Eén keer berekend per nieuwe positie-set. */
  stale = computed<Set<string>>(() => {
    const now = Date.now();
    const out = new Set<string>();
    for (const p of this.positions()) {
      if (!p.is_open || p.current_price == null) continue;
      const at = p.price_as_of ? Date.parse(p.price_as_of) : NaN;
      if (isNaN(at) || now - at > STALE_AFTER_MS) out.add(p.ticker);
    }
    return out;
  });

  /** Tooltip bij het waarschuwingsicoon. */
  staleLabel(p: PositionMetrics): string {
    return `Koers van ${formatDateTime(p.price_as_of)} — verversen bij de koersenbron lukt niet`;
  }

  /** Sorteerwaarde per kolom-key — elke sorteerbare kolom is een PositionMetrics-veld. */
  private posValue(p: PositionMetrics, key: string): string | number | null {
    return p[key as keyof PositionMetrics] as string | number | null;
  }
}
