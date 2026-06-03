import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { MoneyPipe } from '../../shared/number-format/format.pipes';
import { pnlClass } from '../../utils/format';
import type { TaxReport } from '../../models';

@Component({
  selector: 'app-tax',
  standalone: true,
  imports: [MoneyPipe],
  templateUrl: './tax.component.html',
})
export class TaxComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  report = signal<TaxReport | null>(null);
  error = signal<string | null>(null);

  readonly pnlClass = pnlClass;

  ngOnInit(): void {
    this.api.getTaxReport().subscribe({
      next: r => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.error ?? 'Tax data ophalen mislukt');
        this.loading.set(false);
      },
    });
  }
}
