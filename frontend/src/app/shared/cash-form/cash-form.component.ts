import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import type { CashTransaction, CashInput, CashTxType } from '../../models';
import { DecimalInputComponent } from '../decimal-input/decimal-input.component';
import { COMMON_CURRENCIES } from '../../utils/format';

@Component({
  selector: 'app-cash-form',
  standalone: true,
  imports: [FormsModule, DecimalInputComponent],
  templateUrl: './cash-form.component.html',
})
export class CashFormComponent implements OnInit {
  private api = inject(ApiService);

  initial = input<CashTransaction | null>(null);
  saved = output<CashTransaction>();
  cancelled = output<void>();

  form = signal<CashInput>({
    type: 'DEPOSIT',
    amount: 0,
    currency: 'EUR',
    tx_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  saving = signal(false);
  error = signal<string | null>(null);

  readonly types: CashTxType[] = ['DEPOSIT', 'WITHDRAWAL'];
  readonly currencies = COMMON_CURRENCIES;

  ngOnInit(): void {
    const init = this.initial();
    if (init) {
      this.form.set({
        type: init.type,
        amount: init.amount,
        currency: init.currency,
        tx_date: init.tx_date,
        notes: init.notes ?? '',
      });
    }
  }

  patch<K extends keyof CashInput>(key: K, value: CashInput[K]): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  submit(): void {
    this.error.set(null);
    const f = this.form();
    if (f.amount <= 0) {
      this.error.set('Vul een bedrag groter dan 0 in.');
      return;
    }
    this.saving.set(true);
    const init = this.initial();
    const obs = init
      ? this.api.updateCashTransaction(init.id, f)
      : this.api.createCashTransaction(f);
    obs.subscribe({
      next: tx => {
        this.saving.set(false);
        this.saved.emit(tx);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.error ?? 'Opslaan mislukt');
      },
    });
  }
}
