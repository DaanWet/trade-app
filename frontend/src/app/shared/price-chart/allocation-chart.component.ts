import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
} from '@angular/core';
import { ArcElement, Chart, ChartConfiguration, DoughnutController, Tooltip } from 'chart.js';
import { formatMoney, formatPercent } from '../../utils/format';
import type { AllocationSlice } from '../../utils/allocation';

Chart.register(DoughnutController, ArcElement, Tooltip);

/** Kaartachtergrond — de rand tussen de stukken is een spleet in die kleur. */
const SURFACE = '#161b22';

/**
 * Donut van de allocatie. Toont alleen de vorm: de legenda (met waarde en %) staat als
 * lijst in het dashboard, zodat identiteit nooit op kleur alleen rust.
 */
@Component({
  selector: 'app-allocation-chart',
  standalone: true,
  template: '<div style="position: relative; height: 260px;"><canvas #canvas></canvas></div>',
})
export class AllocationChartComponent implements AfterViewInit, OnDestroy {
  slices = input.required<AllocationSlice[]>();
  currency = input<string>('EUR');

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart<'doughnut'>;

  constructor() {
    effect(() => {
      const slices = this.slices();
      if (this.chart) this.render(slices);
    });
  }

  ngAfterViewInit(): void {
    this.render(this.slices());
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(slices: AllocationSlice[]): void {
    const labels = slices.map(s => s.label);
    const values = slices.map(s => s.value);
    const colors = slices.map(s => s.color);

    if (this.chart) {
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = values;
      this.chart.data.datasets[0].backgroundColor = colors;
      this.chart.update();
      return;
    }
    const ctx = this.canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderColor: SURFACE,
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        layout: { padding: 6 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              // De titel toont al de ticker. Lees uit de actuele slices: de chart-instantie
              // overleeft een wissel van data.
              label: ctx => {
                const s = this.slices()[ctx.dataIndex];
                if (!s) return '';
                return `${formatMoney(s.value, this.currency())} (${formatPercent(s.pct, 1)})`;
              },
            },
          },
        },
      },
    };
    this.chart = new Chart(ctx, config);
  }
}
