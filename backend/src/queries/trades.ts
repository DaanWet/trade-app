import { db } from '../db';
import type { TradeSide } from '../helpers/constants';

export interface TradeRow {
  id: number;
  ticker: string;
  trade_date: string;
  side: TradeSide;
  shares: number;
  price: number;
  currency: string;
  fees: number;
  notes: string | null;
  created_at: string;
}

export interface TradeInput {
  ticker: string;
  trade_date: string;
  side: TradeSide;
  shares: number;
  price: number;
  currency: string;
  fees?: number;
  notes?: string | null;
}

export function listTrades(filters?: { ticker?: string }): TradeRow[] {
  if (filters?.ticker) {
    return db.prepare(`
      SELECT * FROM trades WHERE ticker = ? ORDER BY trade_date ASC, id ASC
    `).all(filters.ticker) as TradeRow[];
  }
  return db.prepare(`SELECT * FROM trades ORDER BY trade_date ASC, id ASC`).all() as TradeRow[];
}

export function getTrade(id: number): TradeRow | null {
  return (db.prepare(`SELECT * FROM trades WHERE id = ?`).get(id) as TradeRow | undefined) ?? null;
}

export function insertTrade(input: TradeInput): TradeRow {
  const result = db.prepare(`
    INSERT INTO trades (ticker, trade_date, side, shares, price, currency, fees, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.ticker.toUpperCase(),
    input.trade_date,
    input.side,
    input.shares,
    input.price,
    input.currency.toUpperCase(),
    input.fees ?? 0,
    input.notes ?? null,
  );
  return getTrade(result.lastInsertRowid as number)!;
}

export function updateTrade(id: number, input: TradeInput): TradeRow | null {
  const result = db.prepare(`
    UPDATE trades
    SET ticker = ?, trade_date = ?, side = ?, shares = ?, price = ?, currency = ?, fees = ?, notes = ?
    WHERE id = ?
  `).run(
    input.ticker.toUpperCase(),
    input.trade_date,
    input.side,
    input.shares,
    input.price,
    input.currency.toUpperCase(),
    input.fees ?? 0,
    input.notes ?? null,
    id,
  );
  if (result.changes === 0) return null;
  return getTrade(id);
}

export function deleteTrade(id: number): boolean {
  return db.prepare(`DELETE FROM trades WHERE id = ?`).run(id).changes > 0;
}

export function distinctTickers(): string[] {
  return (db.prepare(`SELECT DISTINCT ticker FROM trades ORDER BY ticker`).all() as { ticker: string }[])
    .map(r => r.ticker);
}

/**
 * Net cash a trade pulls into the position, in the trade's own currency
 * (the "invested" sign convention):
 *   BUY  → +(shares*price + fees)   cash leaves the account, into the position
 *   SELL → −(shares*price − fees)   cash returns from the position
 * The fee always works against you (added on a buy, subtracted on a sell);
 * keeping that subtlety in one place stops the cash balance and the portfolio
 * history's `invested` series from ever drifting apart.
 */
export function tradeCashFlow(t: Pick<TradeRow, 'side' | 'shares' | 'price' | 'fees'>): number {
  const sign = t.side === 'BUY' ? 1 : -1;
  return sign * (t.shares * t.price + sign * t.fees);
}
