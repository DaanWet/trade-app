import { Component, input, output } from '@angular/core';
import type { PositionMetrics } from '../../models';
import {
  sameTickers,
  toggleTicker,
  type TickerGroup,
  type TickerGroupRow,
} from '../../utils/ticker-groups';

/**
 * Tickerfilter van de portefeuillegrafiek: snelkeuzes per groep en een vinkje per ticker.
 * Houdt zelf geen staat bij — het dashboard bewaart de selectie en geeft ze terug.
 */
@Component({
  selector: 'app-ticker-filter',
  standalone: true,
  templateUrl: './ticker-filter.component.html',
})
export class TickerFilterComponent {
  positions = input.required<PositionMetrics[]>();
  groups = input.required<TickerGroupRow[]>();
  /** `null` = alle tickers. */
  selection = input<string[] | null>(null);
  label = input.required<string>();
  selectionChange = output<string[] | null>();

  isActive(group: TickerGroup): boolean {
    return sameTickers(group.tickers, this.selection());
  }

  isChecked(ticker: string): boolean {
    return this.selection()?.includes(ticker) ?? false;
  }

  pickAll(): void {
    this.selectionChange.emit(null);
  }

  /** Een groep vervangt de selectie; daarna kan je losse tickers nog aan- of afvinken. */
  pickGroup(group: TickerGroup): void {
    this.selectionChange.emit([...group.tickers]);
  }

  toggle(ticker: string): void {
    this.selectionChange.emit(toggleTicker(this.selection(), ticker));
  }
}
