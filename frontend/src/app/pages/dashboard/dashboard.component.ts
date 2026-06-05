import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { PositionsTableComponent } from '../../shared/positions-table/positions-table.component';
import { PortfolioChartComponent } from '../../shared/price-chart/portfolio-chart.component';
import { MoneyPipe, PercentPipe } from '../../shared/number-format/format.pipes';
import { pnlClass } from '../../utils/format';
import type { PositionsResponse, PortfolioPoint } from '../../models';

type RangeKey = '7D' | '1M' | '1Q' | 'YTD' | '1Y' | 'MAX' | 'CUSTOM';

/** ISO start date (inclusive) for a fixed range, relative to today. */
function rangeStart(r: Exclude<RangeKey, 'MAX' | 'CUSTOM'>): string {
  const d = new Date();
  if (r === 'YTD') return `${d.getFullYear()}-01-01`;
  if (r === '7D') d.setDate(d.getDate() - 7);
  else if (r === '1M') d.setMonth(d.getMonth() - 1);
  else if (r === '1Q') d.setMonth(d.getMonth() - 3);
  else if (r === '1Y') d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

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

  /** Time-range filter — applied client-side on the already-fetched history. */
  range = signal<RangeKey>('MAX');
  customFrom = signal('');
  customTo = signal('');

  readonly ranges: { key: RangeKey; label: string }[] = [
    { key: '7D', label: '7D' },
    { key: '1M', label: '1M' },
    { key: '1Q', label: '1K' },
    { key: 'YTD', label: 'YTD' },
    { key: '1Y', label: '1J' },
    { key: 'MAX', label: 'Max' },
    { key: 'CUSTOM', label: 'Aangepast' },
  ];

  /** History sliced to the selected range (no extra network call). */
  visibleHistory = computed<PortfolioPoint[]>(() => {
    const all = this.history();
    const r = this.range();
    if (all.length === 0 || r === 'MAX') return all;

    if (r === 'CUSTOM') {
      const from = this.customFrom();
      const to = this.customTo();
      return all.filter(p => (!from || p.date >= from) && (!to || p.date <= to));
    }

    const startIso = rangeStart(r);
    return all.filter(p => p.date >= startIso);
  });

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
