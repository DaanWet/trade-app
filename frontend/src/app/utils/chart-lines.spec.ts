import type { PortfolioPoint } from '../models';
import { buildChartLines, hasSelectionData } from './chart-lines';

function point(date: string, fields: Partial<PortfolioPoint> = {}): PortfolioPoint {
  return { date, market_value: 0, cash: 0, total: 0, net_deposits: 0, by_ticker: {}, ...fields };
}

// 1000 gestort; dag 2 AAA gekocht voor 600; dag 3 AAA +10 % en BBB gekocht voor 200.
const POINTS: PortfolioPoint[] = [
  point('2026-01-02', { cash: 1000, total: 1000, net_deposits: 1000 }),
  point('2026-01-05', {
    market_value: 600,
    cash: 400,
    total: 1000,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 600, invested: 600 } },
  }),
  point('2026-01-06', {
    market_value: 860,
    cash: 200,
    total: 1060,
    net_deposits: 1000,
    by_ticker: { AAA: { value: 660, invested: 600 }, BBB: { value: 200, invested: 200 } },
  }),
];

describe('buildChartLines zonder selectie', () => {
  it('tekent in € Totaal, Aandelen en Netto stortingen zoals ze zijn', () => {
    const lines = buildChartLines(POINTS, null, '', false);

    expect(lines.map(l => [l.key, l.label])).toEqual([
      ['total', 'Totaal'],
      ['stocks', 'Aandelen'],
      ['deposits', 'Netto stortingen'],
    ]);
    expect(lines[0].data).toEqual([1000, 1000, 1060]);
    expect(lines[1].data).toEqual([0, 600, 860]);
    expect(lines[2].data).toEqual([1000, 1000, 1000]);
  });

  it('rekent in % het tijdgewogen rendement en laat Netto stortingen weg', () => {
    const lines = buildChartLines(POINTS, null, '', true);

    expect(lines.map(l => l.key)).toEqual(['total', 'stocks']);
    // Totaal: geen stortingen in het bereik, 1000 → 1060.
    expect(lines[0].data[2]).toBeCloseTo(6, 10);
    // Aandelen: dag 2 de aankoop van 600 (geen rendement); dag 3 +60 op 600 + 200 ingebracht.
    expect(lines[1].data[1]).toBeCloseTo(0, 10);
    expect(lines[1].data[2]).toBeCloseTo(7.5, 10);
  });
});

describe('buildChartLines met selectie', () => {
  it('telt de geselecteerde tickers op uit by_ticker, met het label van de selectie', () => {
    const lines = buildChartLines(POINTS, ['AAA', 'BBB'], '2 tickers', false);

    expect(lines.map(l => [l.key, l.label])).toEqual([
      ['selection', '2 tickers'],
      ['selectionInvested', 'Geïnvesteerd'],
    ]);
    expect(lines[0].data).toEqual([0, 600, 860]);
    expect(lines[1].data).toEqual([0, 600, 800]);
  });

  it('telt een ticker die nog niet in een punt staat als 0', () => {
    const lines = buildChartLines(POINTS, ['BBB'], 'BBB', false);

    expect(lines[0].data).toEqual([0, 0, 200]);
    expect(lines[1].data).toEqual([0, 0, 200]);
  });

  it('rekent in % het rendement van de selectie en laat Geïnvesteerd weg', () => {
    const lines = buildChartLines(POINTS, ['AAA'], 'AAA', true);

    expect(lines.map(l => l.key)).toEqual(['selection']);
    expect(lines[0].data[1]).toBeCloseTo(0, 10);
    expect(lines[0].data[2]).toBeCloseTo(10, 10);
  });

  it('begint een selectie die pas in het bereik gekocht wordt op 0 %, zonder NaN', () => {
    const lines = buildChartLines(POINTS, ['BBB'], 'BBB', true);

    expect(lines[0].data.every(Number.isFinite)).toBeTrue();
    expect(lines[0].data).toEqual([0, 0, 0]);
  });
});

describe('hasSelectionData', () => {
  it('is altijd waar zonder selectie', () => {
    expect(hasSelectionData(POINTS, null)).toBeTrue();
  });

  it('is waar als de selectie iets bezat in het bereik', () => {
    expect(hasSelectionData(POINTS, ['AAA'])).toBeTrue();
  });

  it('is onwaar als de selectie vóór het bereik al volledig verkocht was', () => {
    const sold = [
      point('2026-03-02', { by_ticker: { AAA: { value: 0, invested: -200 } } }),
      point('2026-03-03', { by_ticker: { AAA: { value: 0, invested: -200 } } }),
    ];

    expect(hasSelectionData(sold, ['AAA'])).toBeFalse();
  });

  it('is onwaar voor een ticker die nergens in het bereik voorkomt', () => {
    expect(hasSelectionData(POINTS, ['ZZZ'])).toBeFalse();
  });
});
