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
  ChartDataset,
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
import { buildChartLines, type ChartLine, type ChartLineKey } from '../../utils/chart-lines';

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

const VALUE_FILL: Partial<ChartDataset<'line'>> = {
  borderColor: '#58a6ff',
  backgroundColor: 'rgba(88, 166, 255, 0.15)',
  fill: true,
  tension: 0.2,
  borderWidth: 2,
};
const MONEY_IN: Partial<ChartDataset<'line'>> = {
  borderColor: '#8b949e',
  borderDash: [4, 4],
  fill: false,
  tension: 0,
  borderWidth: 1.5,
};
/** Style per line kind: the value line is blue and filled, money-in lines grey and dashed. */
const LINE_STYLES: Record<ChartLineKey, Partial<ChartDataset<'line'>>> = {
  total: VALUE_FILL,
  selection: VALUE_FILL,
  stocks: { borderColor: '#3fb950', fill: false, tension: 0.2, borderWidth: 1.5 },
  deposits: MONEY_IN,
  selectionInvested: MONEY_IN,
};

function toDataset(line: ChartLine): ChartDataset<'line'> {
  return { ...LINE_STYLES[line.key], label: line.label, data: line.data, pointRadius: 0 };
}

@Component({
  selector: 'app-portfolio-chart',
  standalone: true,
  template: '<div style="position: relative; height: 440px;"><canvas #canvas></canvas></div>',
})
export class PortfolioChartComponent implements AfterViewInit, OnDestroy {
  data = input.required<PortfolioPoint[]>();
  currency = input<string>('EUR');
  /**
   * 'value' → absolute money; 'percent' → time-weighted return since the first visible point
   * (deposits and purchases are not counted as gains; money-in lines are dropped).
   */
  mode = input<'value' | 'percent'>('value');
  /** Ticker filter: `null` → the whole portfolio; otherwise the sum of these tickers. */
  selection = input<string[] | null>(null);
  /** Legend label of the selection line — the filter button's text, e.g. "ETF". */
  selectionLabel = input<string>('');

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart<'line'>;
  /** Keys of the lines currently drawn, to tell "same lines, new data" from "other lines". */
  private lineKeys: ChartLineKey[] = [];
  /** Lines the user hid via the legend, per kind, so the choice survives a swap of lines
   *  (€/% drops a money-in line, the ticker filter swaps them all). */
  private hiddenLines = new Set<ChartLineKey>();

  constructor() {
    effect(() => {
      const points = this.data();
      // Read the other inputs so toggling €/% or the ticker filter re-renders the chart.
      this.mode();
      this.selection();
      this.selectionLabel();
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
    const lines = buildChartLines(points, this.selection(), this.selectionLabel(), percent);
    const keys = lines.map(l => l.key);
    const unit = this.timeUnit(points);

    if (this.chart) {
      this.chart.data.labels = labels;
      if (keys.join('|') === this.lineKeys.join('|')) {
        // Same lines, new data (another range, another label): patch in place so the user's
        // legend toggles survive.
        lines.forEach((line, i) => {
          const dataset = this.chart!.data.datasets[i];
          dataset.data = line.data;
          dataset.label = line.label;
        });
      } else {
        // Other lines (filter on/off, a money-in line in or out with €/%): replace them all,
        // carrying over what the user hid in the legend.
        this.lineKeys.forEach((key, i) => {
          if (this.chart!.isDatasetVisible(i)) this.hiddenLines.delete(key);
          else this.hiddenLines.add(key);
        });
        this.chart.data.datasets = lines.map(line => ({
          ...toDataset(line),
          hidden: this.hiddenLines.has(line.key),
        }));
      }
      this.lineKeys = keys;
      (this.chart.options.scales!['x'] as { time: { unit: string } }).time.unit = unit;
      this.chart.update();
      return;
    }
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.lineKeys = keys;

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels,
        datasets: lines.map(toDataset),
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
