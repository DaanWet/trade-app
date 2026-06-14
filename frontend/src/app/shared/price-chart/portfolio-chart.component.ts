import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  TimeScale,
  Tooltip,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { nlBE } from 'date-fns/locale';
import type { PortfolioPoint } from '../../models';

Chart.register(
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  TimeScale,
  Tooltip,
  Filler,
  Legend,
);

@Component({
  selector: 'app-portfolio-chart',
  standalone: true,
  template: '<div style="position: relative; height: 440px;"><canvas #canvas></canvas></div>',
})
export class PortfolioChartComponent implements AfterViewInit, OnDestroy {
  data = input.required<PortfolioPoint[]>();
  currency = input<string>('EUR');
  /** 'value' → absolute money; 'percent' → % change vs. the first visible point of each line. */
  mode = input<'value' | 'percent'>('value');

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  constructor() {
    effect(() => {
      const points = this.data();
      // Read mode() so toggling €/% re-renders the existing chart.
      this.mode();
      if (this.chart) this.render(points);
    });
  }

  ngAfterViewInit(): void {
    this.render(this.data());
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(points: PortfolioPoint[]): void {
    const labels = points.map(p => p.date);
    const percent = this.mode() === 'percent';
    // In percent mode each line is rebased to its own first visible value (= 0%).
    const total = this.series(points.map(p => p.total), percent);
    const stocks = this.series(points.map(p => p.market_value), percent);
    const deposits = this.series(points.map(p => p.net_deposits), percent);
    const unit = this.timeUnit(points);

    if (this.chart) {
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = total;
      this.chart.data.datasets[1].data = stocks;
      this.chart.data.datasets[2].data = deposits;
      (this.chart.options.scales!['x'] as { time: { unit: string } }).time.unit = unit;
      this.chart.update();
      return;
    }
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Totaal',
            data: total,
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88, 166, 255, 0.15)',
            fill: true,
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'Aandelen',
            data: stocks,
            borderColor: '#3fb950',
            fill: false,
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: 'Netto stortingen',
            data: deposits,
            borderColor: '#8b949e',
            borderDash: [4, 4],
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: {
            type: 'time',
            time: {
              unit,
              // Use 24h time and Belgian-style date tokens. date-fns format strings:
              //   HH = 24h hours, mm = minutes, dd = day, MMM = short month, yyyy = 4-digit year.
              tooltipFormat: 'dd MMM yyyy HH:mm',
              displayFormats: {
                hour: 'HH:mm',
                day: 'dd MMM',
                week: 'dd MMM',
                month: 'MMM yyyy',
                quarter: 'MMM yyyy',
                year: 'yyyy',
              },
            },
            adapters: { date: { locale: nlBE } },
            grid: { color: '#21262d' },
            ticks: { color: '#8b949e' },
          },
          y: {
            grid: { color: '#21262d' },
            ticks: {
              color: '#8b949e',
              // Percent mode → "+1,2 %"; value mode → compact 0-decimal money (nl-BE comma).
              callback: (value) =>
                this.mode() === 'percent'
                  ? this.formatPercent(Number(value), 0)
                  : this.formatMoney(Number(value), 0),
            },
          },
        },
        plugins: {
          // Click a legend entry to hide/show that line — the chart's "filter" controls.
          legend: {
            display: true,
            position: 'top',
            labels: { color: '#c9d1d9', usePointStyle: true, boxWidth: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const y = ctx.parsed.y ?? 0;
                const formatted =
                  this.mode() === 'percent' ? this.formatPercent(y, 2) : this.formatMoney(y, 2);
                return `${ctx.dataset.label}: ${formatted}`;
              },
            },
          },
        },
      },
    };
    this.chart = new Chart(ctx, config);
  }

  /** Pick an x-axis tick granularity that suits the visible date span. */
  private timeUnit(points: PortfolioPoint[]): 'day' | 'week' | 'month' {
    if (points.length < 2) return 'day';
    const spanDays =
      (new Date(points[points.length - 1].date).getTime() - new Date(points[0].date).getTime()) /
      86_400_000;
    if (spanDays <= 31) return 'day';
    if (spanDays <= 180) return 'week';
    return 'month';
  }

  /**
   * In percent mode, rebase a series to its first visible value (= 0%): `(v / base - 1) * 100`.
   * Base is the first non-zero point so e.g. net deposits that start at 0 don't divide by zero;
   * an all-zero series stays flat at 0%. In value mode the raw numbers pass through unchanged.
   */
  private series(values: number[], percent: boolean): number[] {
    if (!percent) return values;
    const base = values.find(v => v !== 0) ?? 0;
    if (base === 0) return values.map(() => 0);
    return values.map(v => (v / base - 1) * 100);
  }

  private formatMoney(value: number, fractionDigits: number): string {
    return new Intl.NumberFormat('nl-BE', {
      style: 'currency',
      currency: this.currency(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }

  private formatPercent(value: number, fractionDigits: number): string {
    return new Intl.NumberFormat('nl-BE', {
      style: 'percent',
      signDisplay: 'exceptZero',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      // Values are already in percent units (e.g. 1.2 = +1,2 %), so divide back out.
    }).format(value / 100);
  }
}
