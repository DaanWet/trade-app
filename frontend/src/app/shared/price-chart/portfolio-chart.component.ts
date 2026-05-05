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

Chart.register(LineController, LineElement, LinearScale, PointElement, TimeScale, Tooltip, Filler);

@Component({
  selector: 'app-portfolio-chart',
  standalone: true,
  template: '<canvas #canvas style="max-height: 320px;"></canvas>',
})
export class PortfolioChartComponent implements AfterViewInit, OnDestroy {
  data = input.required<PortfolioPoint[]>();
  currency = input<string>('EUR');

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  constructor() {
    effect(() => {
      const points = this.data();
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
    if (this.chart) {
      this.chart.data.labels = points.map(p => p.date);
      this.chart.data.datasets[0].data = points.map(p => p.market_value);
      this.chart.data.datasets[1].data = points.map(p => p.invested);
      this.chart.update();
      return;
    }
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: points.map(p => p.date),
        datasets: [
          {
            label: 'Marktwaarde',
            data: points.map(p => p.market_value),
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88, 166, 255, 0.15)',
            fill: true,
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'Geïnvesteerd (cost basis)',
            data: points.map(p => p.invested),
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
              unit: 'month',
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
              // nl-BE → decimal comma. 0 decimals on the axis keeps it compact.
              callback: (value) => this.formatMoney(Number(value), 0),
            },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${this.formatMoney(ctx.parsed.y ?? 0, 2)}`,
            },
          },
        },
      },
    };
    this.chart = new Chart(ctx, config);
  }

  private formatMoney(value: number, fractionDigits: number): string {
    return new Intl.NumberFormat('nl-BE', {
      style: 'currency',
      currency: this.currency(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }
}
