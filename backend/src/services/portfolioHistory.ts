import { listTrades, distinctTickers, tradeCashFlow } from '../queries/trades';
import { listCashTx, cashTxFlow } from '../queries/cash';
import { fetchHistorical } from './marketData';
import { convert, warmHistoricalRates } from './fxService';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';
import { logger } from '../helpers/logger';

export interface PortfolioPoint {
  date: string;
  market_value: number; // stocks only
  cash: number; // cash balance that day (net_deposits − invested)
  total: number; // market_value + cash
  net_deposits: number; // cumulative net deposits that day
}

/**
 * Build a daily time-series of total portfolio value (stocks + cash), in display currency.
 * Strategy:
 *  - For each ticker held at any time, fetch daily closes from the earliest event to today.
 *  - At each calendar day, replay trades up to that day to know shares held per ticker.
 *  - Multiply shares × close × FX rate for that day to get stock market value.
 *  - Replay cash transactions the same way to track net deposits, and derive
 *    cash = net_deposits − net_invested (mirrors cashService) and total = stocks + cash.
 */
export async function buildPortfolioHistory(): Promise<PortfolioPoint[]> {
  const t0 = Date.now();
  const trades = listTrades();
  const cashTxs = listCashTx();
  if (trades.length === 0 && cashTxs.length === 0) return [];

  const tickers = distinctTickers();
  // Earliest event = first trade OR first cash deposit, whichever is older, so a
  // deposit made before the first trade seeds day-one cash. Both lists are ASC.
  const earliestCandidates: string[] = [];
  if (trades.length) earliestCandidates.push(trades[0].trade_date);
  if (cashTxs.length) earliestCandidates.push(cashTxs[0].tx_date);
  const earliest = new Date(earliestCandidates.reduce((a, b) => (a < b ? a : b)));
  const today = new Date();
  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? 'EUR';

  // Determine currency per ticker (assumes one currency per ticker; warned elsewhere if not).
  const tickerCurrency = new Map<string, string>();
  for (const t of tickers) {
    const trade = trades.find(tr => tr.ticker === t)!;
    tickerCurrency.set(t, trade.currency);
  }

  // Fetch historical prices per ticker AND warm all FX rates IN PARALLEL.
  // This turns ~N×days sequential Yahoo hits into a handful of upfront calls.
  const uniquePairs = new Set<string>();
  for (const c of tickerCurrency.values()) {
    if (c !== displayCurrency) uniquePairs.add(`${c}|${displayCurrency}`);
  }
  // Cash deposits/withdrawals can be in a currency no ticker uses — warm those too,
  // otherwise convert() silently returns the unconverted amount and cash is wrong.
  for (const tx of cashTxs) {
    if (tx.currency !== displayCurrency) uniquePairs.add(`${tx.currency}|${displayCurrency}`);
  }
  // Trade-currency → display-currency conversions for cash flows can use other dates,
  // but the same set of pairs covers them.
  const pairs = Array.from(uniquePairs).map(p => {
    const [from, to] = p.split('|');
    return { from, to };
  });

  const histories = new Map<string, Map<string, number>>();
  await Promise.all([
    warmHistoricalRates(pairs, earliest, today),
    ...tickers.map(async t => {
      const prices = await fetchHistorical(t, earliest, today);
      histories.set(t, new Map(prices.map(p => [p.date, p.close])));
    }),
  ]);
  logger.info('history', `data fetched in ${Date.now() - t0}ms`);

  // Walk every calendar day, accumulate shares and value.
  const tradesByDate = new Map<string, typeof trades>();
  for (const t of trades) {
    if (!tradesByDate.has(t.trade_date)) tradesByDate.set(t.trade_date, []);
    tradesByDate.get(t.trade_date)!.push(t);
  }
  const cashByDate = new Map<string, typeof cashTxs>();
  for (const tx of cashTxs) {
    if (!cashByDate.has(tx.tx_date)) cashByDate.set(tx.tx_date, []);
    cashByDate.get(tx.tx_date)!.push(tx);
  }

  const shares = new Map<string, number>();
  let invested = 0;
  let netDeposits = 0;
  const out: PortfolioPoint[] = [];

  const cursor = new Date(earliest);
  while (cursor <= today) {
    const day = cursor.toISOString().slice(0, 10);

    // Apply any trades on this day
    const dayTrades = tradesByDate.get(day) ?? [];
    for (const t of dayTrades) {
      const sign = t.side === 'BUY' ? 1 : -1;
      shares.set(t.ticker, (shares.get(t.ticker) ?? 0) + sign * t.shares);
      invested += await convert(tradeCashFlow(t), t.currency, displayCurrency, t.trade_date);
    }

    // Apply any cash deposits/withdrawals on this day
    const dayCashTxs = cashByDate.get(day) ?? [];
    for (const tx of dayCashTxs) {
      netDeposits += await convert(cashTxFlow(tx), tx.currency, displayCurrency, tx.tx_date);
    }

    // Compute market value at end-of-day (only on weekdays — Yahoo skips weekends)
    let mv = 0;
    let hasAnyPrice = false;
    for (const [ticker, qty] of shares.entries()) {
      if (qty <= 1e-9) continue;
      const closes = histories.get(ticker);
      if (!closes) continue;
      // Find the close on this day, or fall back to the most recent prior close
      let price = closes.get(day);
      if (price == null) {
        const back = new Date(cursor);
        for (let i = 0; i < 7 && price == null; i++) {
          back.setDate(back.getDate() - 1);
          price = closes.get(back.toISOString().slice(0, 10));
        }
      }
      if (price != null) {
        hasAnyPrice = true;
        mv += await convert(qty * price, tickerCurrency.get(ticker)!, displayCurrency, day);
      }
    }

    // Emit on any event day (price, trade, or cash) so the cash/total lines move too.
    if (hasAnyPrice || dayTrades.length > 0 || dayCashTxs.length > 0) {
      const cash = netDeposits - invested;
      out.push({ date: day, market_value: mv, cash, total: mv + cash, net_deposits: netDeposits });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  logger.info('history', `built ${out.length} points in ${Date.now() - t0}ms total`);
  return out;
}
