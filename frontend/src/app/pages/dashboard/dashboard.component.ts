import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { PositionsTableComponent } from '../../shared/positions-table/positions-table.component';
import { PortfolioChartComponent } from '../../shared/price-chart/portfolio-chart.component';
import { MoneyPipe, PercentPipe } from '../../shared/number-format/format.pipes';
import { pnlClass } from '../../utils/format';
import type { PositionsResponse, PortfolioPoint } from '../../models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [PositionsTableComponent, PortfolioChartComponent, MoneyPipe, PercentPipe],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  data = signal<PositionsResponse | null>(null);
  history = signal<PortfolioPoint[]>([]);
  /** Chart is opt-in to avoid the bulky historical/FX Yahoo calls on every dashboard load. */
  chartVisible = signal(false);
  loadingHistory = signal(false);
  error = signal<string | null>(null);

  readonly pnlClass = pnlClass;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getPositions().subscribe({
      next: r => {
        this.data.set(r);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.error ?? 'Posities ophalen mislukt');
        this.loading.set(false);
      },
    });
  }

  showChart(): void {
    this.chartVisible.set(true);
    if (this.history().length === 0) this.loadHistory();
  }

  loadHistory(): void {
    this.loadingHistory.set(true);
    this.api.getPortfolioHistory().subscribe({
      next: h => {
        this.history.set(h);
        this.loadingHistory.set(false);
      },
      error: () => this.loadingHistory.set(false),
    });
  }
}
