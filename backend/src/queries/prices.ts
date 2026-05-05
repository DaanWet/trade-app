import { db } from '../db';

export interface TickerRow {
  symbol: string;
  name: string | null;
  currency: string | null;
  last_price: number | null;
  last_price_at: string | null;
  exchange: string | null;
  quote_type: string | null;
}

export interface FxRateRow {
  base: string;
  quote: string;
  rate_date: string;
  rate: number;
}

export function getTicker(symbol: string): TickerRow | null {
  return (db.prepare(`SELECT * FROM tickers WHERE symbol = ?`).get(symbol.toUpperCase()) as TickerRow | undefined) ?? null;
}

export function upsertTicker(t: Partial<TickerRow> & { symbol: string }): void {
  db.prepare(`
    INSERT INTO tickers (symbol, name, currency, last_price, last_price_at, exchange, quote_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      name          = COALESCE(excluded.name,          tickers.name),
      currency      = COALESCE(excluded.currency,      tickers.currency),
      last_price    = COALESCE(excluded.last_price,    tickers.last_price),
      last_price_at = COALESCE(excluded.last_price_at, tickers.last_price_at),
      exchange      = COALESCE(excluded.exchange,      tickers.exchange),
      quote_type    = COALESCE(excluded.quote_type,    tickers.quote_type)
  `).run(
    t.symbol.toUpperCase(),
    t.name ?? null,
    t.currency ?? null,
    t.last_price ?? null,
    t.last_price_at ?? null,
    t.exchange ?? null,
    t.quote_type ?? null,
  );
}

export function listTickers(symbols: string[]): TickerRow[] {
  if (symbols.length === 0) return [];
  const placeholders = symbols.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM tickers WHERE symbol IN (${placeholders})`).all(
    ...symbols.map(s => s.toUpperCase())
  ) as TickerRow[];
}

export function getFxRate(base: string, quote: string, date: string): FxRateRow | null {
  return (db.prepare(`
    SELECT * FROM fx_rates WHERE base = ? AND quote = ? AND rate_date = ?
  `).get(base.toUpperCase(), quote.toUpperCase(), date) as FxRateRow | undefined) ?? null;
}

export function upsertFxRate(rate: FxRateRow): void {
  db.prepare(`
    INSERT INTO fx_rates (base, quote, rate_date, rate) VALUES (?, ?, ?, ?)
    ON CONFLICT(base, quote, rate_date) DO UPDATE SET rate = excluded.rate
  `).run(rate.base.toUpperCase(), rate.quote.toUpperCase(), rate.rate_date, rate.rate);
}

export function getMostRecentFxRate(base: string, quote: string): FxRateRow | null {
  return (db.prepare(`
    SELECT * FROM fx_rates WHERE base = ? AND quote = ? ORDER BY rate_date DESC LIMIT 1
  `).get(base.toUpperCase(), quote.toUpperCase()) as FxRateRow | undefined) ?? null;
}

export function listFxRatesInRange(base: string, quote: string, fromDate: string, toDate: string): FxRateRow[] {
  return db.prepare(`
    SELECT * FROM fx_rates
    WHERE base = ? AND quote = ? AND rate_date BETWEEN ? AND ?
    ORDER BY rate_date ASC
  `).all(base.toUpperCase(), quote.toUpperCase(), fromDate, toDate) as FxRateRow[];
}

// --- daily_prices ---

export interface DailyPriceRow {
  symbol: string;
  price_date: string;
  close: number;
}

export function getDailyPrice(symbol: string, date: string): DailyPriceRow | null {
  return (db.prepare(`SELECT * FROM daily_prices WHERE symbol = ? AND price_date = ?`)
    .get(symbol.toUpperCase(), date) as DailyPriceRow | undefined) ?? null;
}

export function upsertDailyPrice(row: DailyPriceRow): void {
  db.prepare(`
    INSERT INTO daily_prices (symbol, price_date, close) VALUES (?, ?, ?)
    ON CONFLICT(symbol, price_date) DO UPDATE SET close = excluded.close
  `).run(row.symbol.toUpperCase(), row.price_date, row.close);
}

export function listDailyPricesInRange(symbol: string, fromDate: string, toDate: string): DailyPriceRow[] {
  return db.prepare(`
    SELECT * FROM daily_prices
    WHERE symbol = ? AND price_date BETWEEN ? AND ?
    ORDER BY price_date ASC
  `).all(symbol.toUpperCase(), fromDate, toDate) as DailyPriceRow[];
}

export function getMostRecentDailyPrice(symbol: string): DailyPriceRow | null {
  return (db.prepare(`SELECT * FROM daily_prices WHERE symbol = ? ORDER BY price_date DESC LIMIT 1`)
    .get(symbol.toUpperCase()) as DailyPriceRow | undefined) ?? null;
}
