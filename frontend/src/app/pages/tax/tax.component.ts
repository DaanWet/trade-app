import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { MoneyPipe, SharesPipe, DatePipe } from '../../shared/number-format/format.pipes';
import { pnlClass } from '../../utils/format';
import type { TaxReport, TaxLot, TaxBasis } from '../../models';

@Component({
  selector: 'app-tax',
  standalone: true,
  imports: [MoneyPipe, SharesPipe, DatePipe],
  templateUrl: './tax.component.html',
})
export class TaxComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  report = signal<TaxReport | null>(null);
  lots = signal<TaxLot[]>([]);
  error = signal<string | null>(null);

  readonly pnlClass = pnlClass;

  private static readonly BASIS_LABELS: Record<TaxBasis, string> = {
    none: 'Niet belastbaar',
    purchase: 'Aankoopprijs',
    fotomoment: 'Fotomoment',
    shielded: 'Beschermd',
  };

  basisLabel(basis: TaxBasis): string {
    return TaxComponent.BASIS_LABELS[basis] ?? basis;
  }

  /** Actual display currency the lots were converted to (falls back to the rule currency). */
  displayCurrency(): string {
    const r = this.report();
    return r?.years[0]?.currency ?? r?.params.currency ?? 'EUR';
  }

  basisBadgeClass(basis: TaxBasis): string {
    switch (basis) {
      case 'fotomoment':
        return 'bg-info text-dark';
      case 'shielded':
        return 'bg-success';
      case 'none':
        return 'bg-secondary';
      default:
        return 'bg-light text-dark border';
    }
  }

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
    this.api.getTaxLots().subscribe({
      next: lots => this.lots.set(lots),
      error: () => {
        /* detail table is best-effort; the yearly report already surfaced any error */
      },
    });
  }
}
