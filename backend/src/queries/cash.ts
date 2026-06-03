import { db } from '../db';
import type { CashTxType } from '../helpers/constants';

export interface CashTxRow {
  id: number;
  type: CashTxType;
  amount: number;
  currency: string;
  tx_date: string;
  notes: string | null;
  created_at: string;
}

export interface CashTxInput {
  type: CashTxType;
  amount: number;
  currency: string;
  tx_date: string;
  notes?: string | null;
}

export function listCashTx(): CashTxRow[] {
  return db.prepare(`SELECT * FROM cash_transactions ORDER BY tx_date ASC, id ASC`).all() as CashTxRow[];
}

export function getCashTx(id: number): CashTxRow | null {
  return (db.prepare(`SELECT * FROM cash_transactions WHERE id = ?`).get(id) as CashTxRow | undefined) ?? null;
}

export function insertCashTx(input: CashTxInput): CashTxRow {
  const result = db.prepare(`
    INSERT INTO cash_transactions (type, amount, currency, tx_date, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.type,
    input.amount,
    input.currency.toUpperCase(),
    input.tx_date,
    input.notes ?? null,
  );
  return getCashTx(result.lastInsertRowid as number)!;
}

export function updateCashTx(id: number, input: CashTxInput): CashTxRow | null {
  const result = db.prepare(`
    UPDATE cash_transactions
    SET type = ?, amount = ?, currency = ?, tx_date = ?, notes = ?
    WHERE id = ?
  `).run(
    input.type,
    input.amount,
    input.currency.toUpperCase(),
    input.tx_date,
    input.notes ?? null,
    id,
  );
  if (result.changes === 0) return null;
  return getCashTx(id);
}

export function deleteCashTx(id: number): boolean {
  return db.prepare(`DELETE FROM cash_transactions WHERE id = ?`).run(id).changes > 0;
}
