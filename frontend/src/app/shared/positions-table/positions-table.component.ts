import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { PositionMetrics } from '../../models';
import { MoneyPipe, PercentPipe, SharesPipe } from '../number-format/format.pipes';
import { pnlClass } from '../../utils/format';

@Component({
  selector: 'app-positions-table',
  standalone: true,
  imports: [CommonModule, MoneyPipe, PercentPipe, SharesPipe],
  templateUrl: './positions-table.component.html',
})
export class PositionsTableComponent {
  positions = input.required<PositionMetrics[]>();

  readonly pnlClass = pnlClass;
}
