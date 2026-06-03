import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { TradeFormComponent } from '../../shared/trade-form/trade-form.component';
import { MoneyPipe, SharesPipe, DatePipe } from '../../shared/number-format/format.pipes';
import type { Trade } from '../../models';

@Component({
  selector: 'app-trades',
  standalone: true,
  imports: [TradeFormComponent, MoneyPipe, SharesPipe, DatePipe],
  templateUrl: './trades.component.html',
})
export class TradesComponent implements OnInit {
  private api = inject(ApiService);

  trades = signal<Trade[]>([]);
  loading = signal(true);
  showForm = signal(false);
  editing = signal<Trade | null>(null);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.listTrades().subscribe({
      next: t => {
        // Backend returns ascending by date — show newest first in UI
        this.trades.set([...t].reverse());
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

  remove(trade: Trade): void {
    if (!confirm(`Trade verwijderen: ${trade.side} ${trade.shares} ${trade.ticker} op ${trade.trade_date}?`)) return;
    this.api.deleteTrade(trade.id).subscribe({
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
