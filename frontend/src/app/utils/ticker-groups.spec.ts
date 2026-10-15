import type { PositionMetrics } from '../models';
import {
  buildTickerGroups,
  parseSelection,
  selectionLabel,
  serializeSelection,
  toggleTicker,
  typeLabel,
} from './ticker-groups';

/** Alleen ticker, type, noteringsmunt en open/gesloten doen ertoe; de rest is opvulling. */
function pos(
  ticker: string,
  quoteType: string | null,
  quoteCurrency: string,
  isOpen = true,
): PositionMetrics {
  return {
    ticker,
    currency: 'EUR',
    quote_currency: quoteCurrency,
    quote_type: quoteType,
    name: `${ticker} Inc`,
    shares_open: isOpen ? 1 : 0,
    avg_cost: 0,
    avg_realized_cost: null,
    avg_realized_sell: null,
    cost_basis: 0,
    current_price: null,
    previous_close: null,
    price_as_of: null,
    market_value: null,
    unrealized_pnl: null,
    unrealized_pct: null,
    realized_pnl: 0,
    total_pnl: null,
    total_buys: 1,
    total_sells: 0,
    is_open: isOpen,
    display_currency: 'EUR',
    cost_basis_display: 0,
    market_value_display: null,
    unrealized_pnl_display: null,
    realized_pnl_display: 0,
    total_pnl_display: null,
    day_pnl_display: null,
    day_pnl_pct: null,
  };
}

const PORTFOLIO: PositionMetrics[] = [
  pos('AMD', 'EQUITY', 'USD'),
  pos('CAS', 'ETF', 'USD'),
  pos('HYPG', 'ETF', 'USD'),
  pos('KBC.BR', 'EQUITY', 'EUR'),
  pos('NG=F', 'FUTURE', 'USD', false),
  pos('ZAR=X', 'CURRENCY', 'ZAR'),
];

describe('buildTickerGroups', () => {
  it('maakt rijen voor status, type en valuta met enkel niet-lege groepen', () => {
    const rows = buildTickerGroups(PORTFOLIO);

    expect(rows.map(r => r.key)).toEqual(['status', 'type', 'currency']);
    expect(rows[0].groups.map(g => [g.label, g.tickers])).toEqual([
      ['Open', ['AMD', 'CAS', 'HYPG', 'KBC.BR', 'ZAR=X']],
      ['Gesloten', ['NG=F']],
    ]);
    expect(rows[1].groups.map(g => g.label)).toEqual(['Aandeel', 'ETF', 'Future', 'FX']);
    expect(rows[2].groups.map(g => [g.label, g.tickers])).toEqual([
      ['EUR', ['KBC.BR']],
      ['USD', ['AMD', 'CAS', 'HYPG', 'NG=F']],
      ['ZAR', ['ZAR=X']],
    ]);
  });

  it('laat Gesloten weg als alles open is', () => {
    const rows = buildTickerGroups([pos('AMD', 'EQUITY', 'USD')]);

    expect(rows[0].groups.map(g => g.label)).toEqual(['Open']);
  });

  it('groepeert een onbekend of ontbrekend type onder Overig', () => {
    const rows = buildTickerGroups([pos('AAA', null, 'EUR'), pos('BBB', 'WARRANT', 'EUR')]);
    const type = rows.find(r => r.key === 'type')!;

    expect(type.groups).toEqual([{ key: 'type:Overig', label: 'Overig', tickers: ['AAA', 'BBB'] }]);
  });

  it('groepeert op noteringsmunt, niet op handelsmunt', () => {
    // pos() boekt altijd in EUR; de noteringsmunt is USD.
    const rows = buildTickerGroups([pos('AMD', 'EQUITY', 'USD')]);

    expect(rows.find(r => r.key === 'currency')!.groups.map(g => g.label)).toEqual(['USD']);
  });

  it('geeft geen rijen zonder posities', () => {
    expect(buildTickerGroups([])).toEqual([]);
  });
});

describe('typeLabel', () => {
  it('noemt CURRENCY "FX", zodat het niet botst met de rij Valuta', () => {
    expect(typeLabel('CURRENCY')).toBe('FX');
  });
});

describe('selectionLabel', () => {
  const rows = buildTickerGroups(PORTFOLIO);

  it('toont "Alle tickers" zonder selectie', () => {
    expect(selectionLabel(null, rows)).toBe('Alle tickers');
  });

  it('toont de groepsnaam als de selectie precies een groep is, in eender welke volgorde', () => {
    expect(selectionLabel(['HYPG', 'CAS'], rows)).toBe('ETF');
  });

  it('toont het symbool bij één ticker, ook als die in zijn eentje een groep vormt', () => {
    // NG=F is in z'n eentje ook de groepen Gesloten en Future.
    expect(selectionLabel(['NG=F'], rows)).toBe('NG=F');
  });

  it('telt de tickers bij een losse selectie', () => {
    expect(selectionLabel(['AMD', 'CAS'], rows)).toBe('2 tickers');
  });
});

describe('toggleTicker', () => {
  it('selecteert vanuit alle enkel de aangeklikte ticker', () => {
    expect(toggleTicker(null, 'AMD')).toEqual(['AMD']);
  });

  it('voegt toe en haalt weg', () => {
    expect(toggleTicker(['AMD'], 'CAS')).toEqual(['AMD', 'CAS']);
    expect(toggleTicker(['AMD', 'CAS'], 'AMD')).toEqual(['CAS']);
  });

  it('gaat terug naar alle bij het afvinken van de laatste', () => {
    expect(toggleTicker(['AMD'], 'AMD')).toBeNull();
  });
});

describe('parseSelection / serializeSelection', () => {
  it('bewaart symbolen met = en . ongeschonden', () => {
    const stored = serializeSelection(['ZAR=X', 'KBC.BR', 'NG=F']);

    expect(stored).toBe('KBC.BR,NG=F,ZAR=X');
    expect(parseSelection(stored, PORTFOLIO)).toEqual(['KBC.BR', 'NG=F', 'ZAR=X']);
  });

  it('laat tickers vallen die niet meer bestaan', () => {
    expect(parseSelection('AMD,GONE', PORTFOLIO)).toEqual(['AMD']);
  });

  it('valt terug op alle bij leeg, onzin of niets meer over', () => {
    expect(parseSelection('', PORTFOLIO)).toBeNull();
    expect(parseSelection(',,', PORTFOLIO)).toBeNull();
    expect(parseSelection('GONE', PORTFOLIO)).toBeNull();
  });

  it('ontdubbelt', () => {
    expect(parseSelection('AMD,AMD', PORTFOLIO)).toEqual(['AMD']);
  });

  it('schrijft alle weg als lege tekst', () => {
    expect(serializeSelection(null)).toBe('');
  });
});
