import { listCashTx } from '../queries/cash';
import { listTrades, tradeCashFlow } from '../queries/trades';
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
    const sign = tx.type === 'DEPOSIT' ? 1 : -1;
    netDeposits += sign * (await convert(tx.amount, tx.currency, displayCurrency, tx.tx_date));
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
