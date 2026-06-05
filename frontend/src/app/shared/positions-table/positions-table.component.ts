import { Component, computed, input } from '@angular/core';
import type { PositionMetrics } from '../../models';
import { MoneyPipe, PercentPipe, SharesPipe } from '../number-format/format.pipes';
import { pnlClass } from '../../utils/format';
import { SortState, compareValues } from '../../utils/sort';

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

  /** Sorteerwaarde per kolom-key — elke sorteerbare kolom is een PositionMetrics-veld. */
  private posValue(p: PositionMetrics, key: string): string | number | null {
    return p[key as keyof PositionMetrics] as string | number | null;
  }
}
