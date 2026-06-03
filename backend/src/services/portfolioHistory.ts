import { listTrades, distinctTickers, tradeCashFlow } from '../queries/trades';
import { fetchHistorical } from './marketData';
import { convert, warmHistoricalRates } from './fxService';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';

export interface PortfolioPoint {
  date: string;
  market_value: number;
  invested: number;
  pnl: number;
}

/**
 * Build a daily time-series of total portfolio value, in display currency.
 * Strategy:
 *  - For each ticker held at any time, fetch daily closes from earliest trade to today.
 *  - At each calendar day, replay trades up to that day to know shares held per ticker.
 *  - Multiply shares × close × FX rate for that day to get market value.
 *  - Track cumulative net invested (buys − sells) for the same series.
 */
export async function buildPortfolioHistory(): Promise<PortfolioPoint[]> {
  const t0 = Date.now();
  const trades = listTrades();
  if (trades.length === 0) return [];

  const tickers = distinctTickers();
  const earliest = new Date(trades[0].trade_date);
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
  console.log(`[history] data fetched in ${Date.now() - t0}ms`);

  // Walk every calendar day, accumulate shares and value.
  const tradesByDate = new Map<string, typeof trades>();
  for (const t of trades) {
    if (!tradesByDate.has(t.trade_date)) tradesByDate.set(t.trade_date, []);
    tradesByDate.get(t.trade_date)!.push(t);
  }

  const shares = new Map<string, number>();
  let invested = 0;
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

    if (hasAnyPrice || dayTrades.length > 0) {
      out.push({ date: day, market_value: mv, invested, pnl: mv - invested });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  console.log(`[history] built ${out.length} points in ${Date.now() - t0}ms total`);
  return out;
}
