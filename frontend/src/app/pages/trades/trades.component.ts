import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { TradeFormComponent } from '../../shared/trade-form/trade-form.component';
import { MoneyPipe, SharesPipe, DatePipe } from '../../shared/number-format/format.pipes';
import { SortState, compareValues } from '../../utils/sort';
import type { Trade, TradeSide } from '../../models';

@Component({
  selector: 'app-trades',
  standalone: true,
  imports: [TradeFormComponent, MoneyPipe, SharesPipe, DatePipe],
  templateUrl: './trades.component.html',
})
export class TradesComponent implements OnInit {
  private api = inject(ApiService);
  private confirm = inject(ConfirmService);

  trades = signal<Trade[]>([]);
  loading = signal(true);
  showForm = signal(false);
  editing = signal<Trade | null>(null);
  error = signal<string | null>(null);

  // Sorteren (standaard: datum aflopend = nieuwste eerst) + filters ('' = uit).
  sort = new SortState('trade_date', 'desc');
  tickerFilter = signal('');
  sideFilter = signal<'' | TradeSide>('');
  dateFrom = signal('');
  dateTo = signal('');

  /** Unieke tickers uit de trades, voor de filter-dropdown. */
  tickerOptions = computed(() => [...new Set(this.trades().map(t => t.ticker))].sort());

  /** Gefilterde + gesorteerde rijen die de tabel toont. */
  visible = computed<Trade[]>(() => {
    const ticker = this.tickerFilter();
    const side = this.sideFilter();
    const from = this.dateFrom();
    const to = this.dateTo();

    const rows = this.trades().filter(t => {
      if (ticker && t.ticker !== ticker) return false;
      if (side && t.side !== side) return false;
      if (from && t.trade_date < from) return false;
      if (to && t.trade_date > to) return false;
      return true;
    });

    const key = this.sort.key();
    if (!key) return rows;
    const dir = this.sort.dir() === 'asc' ? 1 : -1;
    // rows is al een verse .filter()-array — in-place sorteren raakt het signal niet.
    return rows.sort(
      (a, b) => compareValues(this.tradeValue(a, key), this.tradeValue(b, key)) * dir,
    );
  });

  hasActiveFilters = computed(
    () => !!(this.tickerFilter() || this.sideFilter() || this.dateFrom() || this.dateTo()),
  );

  /** Sorteerwaarde per kolom-key. */
  private tradeValue(t: Trade, key: string): string | number {
    switch (key) {
      case 'ticker':
        return t.ticker;
      case 'side':
        return t.side;
      case 'shares':
        return t.shares;
      case 'price':
        return t.price;
      case 'fees':
        return t.fees;
      case 'total':
        return t.shares * t.price + t.fees;
      case 'trade_date':
      default:
        return t.trade_date;
    }
  }

  clearFilters(): void {
    this.tickerFilter.set('');
    this.sideFilter.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.listTrades().subscribe({
      next: t => {
        // Volgorde regelt de client-side sort (standaard datum aflopend).
        this.trades.set([...t]);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.error ?? 'Ophalen mislukt');
        this.loading.set(false);
      },
    });
  }

  newTrade(): void {
    this.editing.set(null);
    this.showForm.set(true);
  }

  edit(trade: Trade): void {
    this.editing.set(trade);
    this.showForm.set(true);
  }

  async remove(trade: Trade): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Trade verwijderen',
      message: `Trade verwijderen: ${trade.side} ${trade.shares} ${trade.ticker} op ${trade.trade_date}?`,
      confirmText: 'Verwijderen',
      confirmClass: 'btn-danger',
    });
    if (!ok) return;
    // Deleting a SELL can overdraw cash → the backend returns 409; the helper
    // surfaces the warning and retries once with confirm.
    this.confirm
      .confirmOnCashOverdraw(c => this.api.deleteTrade(trade.id, c), {
        confirmText: 'Toch verwijderen',
        question: 'Toch verwijderen?',
      })
      .subscribe({
        next: () => this.refresh(),
        error: err => this.error.set(err?.error?.error ?? 'Verwijderen mislukt'),
      });
  }

  onSaved(): void {
    this.showForm.set(false);
    this.editing.set(null);
    this.refresh();
  }

  onCancel(): void {
    this.showForm.set(false);
    this.editing.set(null);
  }
}
