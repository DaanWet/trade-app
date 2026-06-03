import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { CashFormComponent } from '../../shared/cash-form/cash-form.component';
import { MoneyPipe, DatePipe } from '../../shared/number-format/format.pipes';
import { pnlClass } from '../../utils/format';
import type { CashResponse, CashTransaction } from '../../models';

@Component({
  selector: 'app-cash',
  standalone: true,
  imports: [CashFormComponent, MoneyPipe, DatePipe],
  templateUrl: './cash.component.html',
})
export class CashComponent implements OnInit {
  private api = inject(ApiService);
  private confirm = inject(ConfirmService);

  data = signal<CashResponse | null>(null);
  showForm = signal(false);
  editing = signal<CashTransaction | null>(null);
  error = signal<string | null>(null);

  readonly pnlClass = pnlClass;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.getCash().subscribe({
      next: r => {
        // Backend returns ascending by date — show newest first in UI
        this.data.set({ ...r, transactions: [...r.transactions].reverse() });
      },
      error: err => {
        this.error.set(err?.error?.error ?? 'Ophalen mislukt');
      },
    });
  }

  newTx(): void {
    this.editing.set(null);
    this.showForm.set(true);
  }

  edit(tx: CashTransaction): void {
    this.editing.set(tx);
    this.showForm.set(true);
  }

  async remove(tx: CashTransaction): Promise<void> {
    const label = tx.type === 'DEPOSIT' ? 'storting' : 'opname';
    const ok = await this.confirm.ask({
      title: 'Cash-transactie verwijderen',
      message: `Cash-transactie verwijderen: ${label} ${tx.amount} ${tx.currency} op ${tx.tx_date}?`,
      confirmText: 'Verwijderen',
      confirmClass: 'btn-danger',
    });
    if (!ok) return;
    this.api.deleteCashTransaction(tx.id).subscribe({
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
