import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
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
  private confirm = inject(ConfirmService);

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

  async remove(trade: Trade): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Trade verwijderen',
      message: `Trade verwijderen: ${trade.side} ${trade.shares} ${trade.ticker} op ${trade.trade_date}?`,
      confirmText: 'Verwijderen',
      confirmClass: 'btn-danger',
    });
    if (!ok) return;
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
