import type { PositionMetrics } from '../models';
import { CASH_KEY, OTHER_KEY, computeAllocation } from './allocation';

/** Alleen de velden die de allocatie leest doen ertoe; de rest is opvulling. */
function pos(ticker: string, value: number | null, isOpen = true): PositionMetrics {
  return {
    ticker,
    currency: 'EUR',
    quote_currency: 'EUR',
    name: `${ticker} Inc`,
    shares_open: isOpen ? 1 : 0,
    avg_cost: 0,
    avg_realized_cost: null,
    avg_realized_sell: null,
    cost_basis: 0,
    current_price: value,
    previous_close: null,
    price_as_of: null,
    market_value: value,
    unrealized_pnl: null,
    unrealized_pct: null,
    realized_pnl: 0,
    total_pnl: null,
    total_buys: 1,
    total_sells: 0,
    is_open: isOpen,
    display_currency: 'EUR',
    cost_basis_display: 0,
    market_value_display: value,
    unrealized_pnl_display: null,
    realized_pnl_display: 0,
    total_pnl_display: null,
    day_pnl_display: null,
    day_pnl_pct: null,
  };
}

describe('computeAllocation', () => {
  it('weegt open posities op marktwaarde, grootste eerst', () => {
    const a = computeAllocation([pos('AAA', 100), pos('BBB', 300)], 0, false);

    expect(a.slices.map(s => s.key)).toEqual(['BBB', 'AAA']);
    expect(a.slices.map(s => s.pct)).toEqual([75, 25]);
    expect(a.total).toBe(400);
  });

  it('laat gesloten posities weg', () => {
    const a = computeAllocation([pos('AAA', 100), pos('OLD', 0, false)], 0, false);

    expect(a.slices.map(s => s.key)).toEqual(['AAA']);
  });

  it('voegt cash als laatste stuk toe en rekent dan op de netto waarde', () => {
    const a = computeAllocation([pos('AAA', 300)], 100, true);

    expect(a.slices.map(s => s.key)).toEqual(['AAA', CASH_KEY]);
    expect(a.slices.map(s => s.pct)).toEqual([75, 25]);
    expect(a.total).toBe(400);
  });

  it('negeert cash zonder de cash-schakelaar', () => {
    const a = computeAllocation([pos('AAA', 300)], 100, false);

    expect(a.slices.map(s => s.key)).toEqual(['AAA']);
    expect(a.total).toBe(300);
  });

  it('neemt negatieve of nulcash niet op, ook niet met de schakelaar aan', () => {
    expect(computeAllocation([pos('AAA', 300)], -50, true).slices.map(s => s.key)).toEqual(['AAA']);
    expect(computeAllocation([pos('AAA', 300)], 0, true).slices.map(s => s.key)).toEqual(['AAA']);
  });

  it('telt open posities zonder koers als unpriced en laat ze weg', () => {
    const a = computeAllocation([pos('AAA', 100), pos('NOPX', null)], 0, false);

    expect(a.slices.map(s => s.key)).toEqual(['AAA']);
    expect(a.unpriced).toBe(1);
  });

  it('bundelt alles voorbij de zevende ticker in één Overig-stuk', () => {
    const positions = [90, 80, 70, 60, 50, 40, 30, 20, 10].map((v, i) => pos(`T${i + 1}`, v));
    const a = computeAllocation(positions, 0, false);

    expect(a.slices.map(s => s.key)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', OTHER_KEY]);
    expect(a.slices[7].value).toBe(30);
  });

  it('houdt in de legenda elke ticker apart, ook de gebundelde', () => {
    const positions = [90, 80, 70, 60, 50, 40, 30, 20, 10].map((v, i) => pos(`T${i + 1}`, v));
    const a = computeAllocation(positions, 50, true);

    expect(a.rows.map(r => r.key)).toEqual([
      'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', CASH_KEY,
    ]);
    const other = a.slices.find(s => s.key === OTHER_KEY)!;
    expect(a.rows[7].color).toBe(other.color);
    expect(a.rows[8].color).toBe(other.color);
  });

  it('geeft elke ticker een eigen kleur, los van cash en Overig', () => {
    const positions = [90, 80, 70, 60, 50, 40, 30, 20].map((v, i) => pos(`T${i + 1}`, v));
    const colors = computeAllocation(positions, 50, true).slices.map(s => s.color);

    expect(new Set(colors).size).toBe(colors.length);
  });

  it('herkleurt tickers niet bij het omzetten van de cash-schakelaar', () => {
    const positions = [pos('AAA', 300), pos('BBB', 100)];
    const colorsOf = (includeCash: boolean) =>
      computeAllocation(positions, 50, includeCash)
        .slices.filter(s => s.key !== CASH_KEY)
        .map(s => s.color);

    expect(colorsOf(true)).toEqual(colorsOf(false));
  });

  it('geeft een lege allocatie zonder posities en zonder cash', () => {
    const a = computeAllocation([], 0, true);

    expect(a.slices).toEqual([]);
    expect(a.total).toBe(0);
  });
});
