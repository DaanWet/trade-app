import { TestBed } from '@angular/core/testing';
import type { Chart } from 'chart.js';
import type { PortfolioPoint } from '../../models';
import { PortfolioChartComponent } from './portfolio-chart.component';

function point(date: string, fields: Partial<PortfolioPoint> = {}): PortfolioPoint {
  return { date, market_value: 0, cash: 0, total: 0, net_deposits: 0, by_ticker: {}, ...fields };
}

const POINTS: PortfolioPoint[] = [
  point('2026-01-05', {
    market_value: 600,
    cash: 400,
    total: 1000,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 600, invested: 600 } },
  }),
  point('2026-01-06', {
    market_value: 660,
    cash: 400,
    total: 1060,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 660, invested: 600 } },
  }),
];

describe('PortfolioChartComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [PortfolioChartComponent] }));

  it('wisselt tussen alle tickers, een selectie en % zonder achtergebleven lijnen', () => {
    const fixture = TestBed.createComponent(PortfolioChartComponent);
    // What the legend shows, not what the component assigned: catches stale Chart.js metas.
    const labels = () =>
      (fixture.componentInstance as unknown as { chart: Chart }).chart.legend!.legendItems!.map(
        i => i.text,
      );
    fixture.componentRef.setInput('data', POINTS);
    fixture.detectChanges();
    expect(labels()).toEqual(['Totaal', 'Aandelen', 'Netto stortingen']);

    fixture.componentRef.setInput('selection', ['AAA']);
    fixture.componentRef.setInput('selectionLabel', 'AAA');
    fixture.detectChanges();
    expect(labels()).toEqual(['AAA', 'Geïnvesteerd']);

    fixture.componentRef.setInput('mode', 'percent');
    fixture.detectChanges();
    expect(labels()).toEqual(['AAA']);

    fixture.componentRef.setInput('selection', null);
    fixture.detectChanges();
    expect(labels()).toEqual(['Totaal', 'Aandelen']);
  });

  it('onthoudt welke lijnen je in de legende verborg, ook over €/% en de selectie heen', () => {
    const fixture = TestBed.createComponent(PortfolioChartComponent);
    const chart = () => (fixture.componentInstance as unknown as { chart: Chart }).chart;
    const visible = () =>
      chart()
        .legend!.legendItems!.filter(i => !i.hidden)
        .map(i => i.text);
    fixture.componentRef.setInput('data', POINTS);
    fixture.detectChanges();

    // Zoals een klik op "Totaal" in de legende.
    chart().setDatasetVisibility(0, false);
    chart().update();
    expect(visible()).toEqual(['Aandelen', 'Netto stortingen']);

    fixture.componentRef.setInput('mode', 'percent');
    fixture.detectChanges();
    expect(visible()).toEqual(['Aandelen']);

    fixture.componentRef.setInput('mode', 'value');
    fixture.detectChanges();
    expect(visible()).toEqual(['Aandelen', 'Netto stortingen']);

    fixture.componentRef.setInput('selection', ['AAA']);
    fixture.componentRef.setInput('selectionLabel', 'AAA');
    fixture.detectChanges();
    expect(visible()).toEqual(['AAA', 'Geïnvesteerd']);

    fixture.componentRef.setInput('selection', null);
    fixture.detectChanges();
    expect(visible()).toEqual(['Aandelen', 'Netto stortingen']);
  });
});
