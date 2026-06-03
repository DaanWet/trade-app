import { listCashTx, cashTxFlow, type CashTxRow } from '../queries/cash';
import { listTrades, tradeCashFlow, type TradeRow } from '../queries/trades';
import { convert } from './fxService';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';

export interface CashSummary {
  display_currency: string;
  net_deposits: number; // Σ DEPOSIT − Σ WITHDRAWAL (display currency)
  invested: number; // net invested in stocks (display currency)
  cash_balance: number; // net_deposits − invested
}

/**
 * Compute the current cash balance, in display currency.
 *
 * The balance is fully derived (no separate ledger):
 *   cash_balance = net_deposits − net_invested
 * where net_deposits = Σ DEPOSIT − Σ WITHDRAWAL (each converted at its tx date),
 * and net_invested mirrors the cash-flow formula in portfolioHistory:
 *   BUY  reduces cash by shares*price + fees
 *   SELL increases cash by shares*price − fees
 * A negative balance is allowed (you bought/withdrew more than you deposited).
 */
export async function computeCashSummary(): Promise<CashSummary> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? 'EUR';

  let netDeposits = 0;
  for (const tx of listCashTx()) {
    netDeposits += await convert(cashTxFlow(tx), tx.currency, displayCurrency, tx.tx_date);
  }

  let invested = 0;
  for (const t of listTrades()) {
    invested += await convert(tradeCashFlow(t), t.currency, displayCurrency, t.trade_date);
  }

  return {
    display_currency: displayCurrency,
    net_deposits: netDeposits,
    invested,
    cash_balance: netDeposits - invested,
  };
}

/** The fields of a trade needed to value its cash effect. */
export type TradeCashFields = Pick<TradeRow, 'side' | 'shares' | 'price' | 'fees' | 'currency' | 'trade_date'>;

/** User-facing shortfall message, shared by the trade- and cash-overdraw responses. */
export function cashShortfallMessage(subject: string, projected: number, cashBalance: number): string {
  return `Onvoldoende cash: deze ${subject} brengt je saldo op ${projected.toFixed(2)} (nu ${cashBalance.toFixed(2)}).`;
}

/** The fields of a cash transaction needed to value its cash effect. */
export type CashTxCashFields = Pick<CashTxRow, 'type' | 'amount' | 'currency' | 'tx_date'>;

export interface CashProjection {
  cash_balance: number; // current balance, display currency
  projected: number; // balance after applying `next` (replacing `previous`, if editing)
  /** true when the change lowers cash AND ends up negative. */
  overdraws: boolean;
}

const EPS = 1e-6;

/** Does this projection lower cash into the negative? (A change that raises cash never does.) */
function overdraws(cashBalance: number, projected: number): boolean {
  return projected < -EPS && projected < cashBalance - EPS;
}

/**
 * Project the cash balance after creating (or editing) a trade, in display currency.
 * For an edit, pass the existing row as `previous` so its effect is swapped out.
 * `overdraws` only flags trades that *reduce* cash into the negative — a SELL (which
 * raises cash) never trips it, even if the balance was already negative.
 */
export async function projectCashAfterTrade(
  next: TradeCashFields,
  previous?: TradeCashFields | null,
): Promise<CashProjection> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? 'EUR';
  const { cash_balance } = await computeCashSummary();

  let projected = cash_balance;
  // computeCashSummary() already includes `previous` (it is in the DB); back it out.
  if (previous) projected += await convert(tradeCashFlow(previous), previous.currency, displayCurrency, previous.trade_date);
  projected -= await convert(tradeCashFlow(next), next.currency, displayCurrency, next.trade_date);

  return { cash_balance, projected, overdraws: overdraws(cash_balance, projected) };
}

/**
 * Project the cash balance after a cash-transaction change, in display currency.
 * `next` is the new row (null when deleting); pass the existing row as `previous`
 * for an edit/delete so its current effect is swapped out. `overdraws` flags a
 * change that lowers cash into the negative (e.g. a withdrawal beyond the balance).
 */
export async function projectCashAfterCashTx(
  next: CashTxCashFields | null,
  previous?: CashTxCashFields | null,
): Promise<CashProjection> {
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? 'EUR';
  const { cash_balance } = await computeCashSummary();

  let projected = cash_balance;
  // computeCashSummary() already includes `previous` (it is in the DB); back it out.
  if (previous) projected -= await convert(cashTxFlow(previous), previous.currency, displayCurrency, previous.tx_date);
  if (next) projected += await convert(cashTxFlow(next), next.currency, displayCurrency, next.tx_date);

  return { cash_balance, projected, overdraws: overdraws(cash_balance, projected) };
}
