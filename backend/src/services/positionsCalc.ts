import { listTrades, distinctTickers, type TradeRow } from '../queries/trades';
import { fetchQuotes } from './marketData';
import { convert } from './fxService';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';
import type { TickerRow } from '../queries/prices';

/**
 * One open BUY lot waiting to be matched against a SELL.
 * Used internally by the FIFO walk.
 */
interface OpenLot {
  shares_remaining: number;
  cost_per_share: number; // includes proportional fee from the buy
  trade_date: string;
  trade_id: number;
}

/**
 * One realized round-trip (a SELL matched against one or more BUYs).
 * All amounts are in the trade currency of the position.
 */
export interface RealizedLot {
  ticker: string;
  buy_date: string;
  sell_date: string;
  shares: number;
  cost_basis: number;
  proceeds: number;
  realized_pnl: number;
  currency: string;
}

/**
 * Aggregated state for one ticker.
 * Native amounts are in the ticker's trade currency; *_display variants are converted.
 */
export interface PositionMetrics {
  ticker: string;
  name: string | null;
  currency: string;            // trade currency of the position
  shares_open: number;
  avg_cost: number;            // weighted-average cost per share of remaining open shares
  cost_basis: number;          // shares_open * avg_cost (open lots cost)
  current_price: number | null;
  market_value: number | null; // shares_open * current_price
  unrealized_pnl: number | null;
  unrealized_pct: number | null;
  realized_pnl: number;        // sum of all realized P&L on this ticker
  total_pnl: number | null;    // realized + unrealized
  total_buys: number;          // total cost of all buys ever (incl. closed)
  total_sells: number;         // total proceeds of all sells ever
  is_open: boolean;            // shares_open > 0

  // Display-currency variants (converted with spot rate for display)
  display_currency: string;
  cost_basis_display: number;
  market_value_display: number | null;
  unrealized_pnl_display: number | null;
  realized_pnl_display: number;
  total_pnl_display: number | null;
}

interface PositionState {
  ticker: string;
  currency: string;
  open_lots: OpenLot[];
  realized: RealizedLot[];
  total_buys: number;
  total_sells: number;
}

/**
 * Walk a chronologically sorted list of trades for a single ticker
 * and return the FIFO state (open lots + realized lots).
 */
export function walkTrades(trades: TradeRow[]): PositionState {
  if (trades.length === 0) {
    throw new Error('walkTrades requires at least one trade');
  }
  const ticker = trades[0].ticker;
  // Trades for one ticker should share a currency. If not, we use the first one
  // and warn — mixed-currency tickers are not realistic.
  const currency = trades[0].currency;

  const openLots: OpenLot[] = [];
  const realized: RealizedLot[] = [];
  let totalBuys = 0;
  let totalSells = 0;

  for (const t of trades) {
    if (t.currency !== currency) {
      console.warn(`[positions] ${ticker} has mixed currencies (${currency} vs ${t.currency}); using first.`);
    }

    if (t.side === 'BUY') {
      const grossCost = t.shares * t.price + t.fees;
      totalBuys += grossCost;
      openLots.push({
        shares_remaining: t.shares,
        cost_per_share: grossCost / t.shares,
        trade_date: t.trade_date,
        trade_id: t.id,
      });
      continue;
    }

    // SELL — match against open lots FIFO
    const grossProceeds = t.shares * t.price - t.fees;
    totalSells += grossProceeds;
    let sharesToClose = t.shares;
    const proceedsPerShare = grossProceeds / t.shares;

    while (sharesToClose > 1e-12 && openLots.length > 0) {
      const lot = openLots[0];
      const matched = Math.min(lot.shares_remaining, sharesToClose);
      const costBasis = matched * lot.cost_per_share;
      const proceeds = matched * proceedsPerShare;

      realized.push({
        ticker,
        buy_date: lot.trade_date,
        sell_date: t.trade_date,
        shares: matched,
        cost_basis: costBasis,
        proceeds,
        realized_pnl: proceeds - costBasis,
        currency,
      });

      lot.shares_remaining -= matched;
      sharesToClose -= matched;
      if (lot.shares_remaining < 1e-12) openLots.shift();
    }

    if (sharesToClose > 1e-9) {
      console.warn(`[positions] ${ticker} sold ${t.shares} on ${t.trade_date} but only ${t.shares - sharesToClose} were covered by open lots. Short positions are not modeled.`);
    }
  }

  return { ticker, currency, open_lots: openLots, realized, total_buys: totalBuys, total_sells: totalSells };
}

/**
 * Compute metrics for every ticker that has at least one trade.
 * Fetches live prices and converts to the user's display currency.
 */
export async function computeAllPositions(): Promise<PositionMetrics[]> {
  const tickers = distinctTickers();
  if (tickers.length === 0) return [];

  const allTrades = listTrades();
  const tradesByTicker = new Map<string, TradeRow[]>();
  for (const t of allTrades) {
    if (!tradesByTicker.has(t.ticker)) tradesByTicker.set(t.ticker, []);
    tradesByTicker.get(t.ticker)!.push(t);
  }

  const quotes = await fetchQuotes(tickers);
  const quotesBySym = new Map(quotes.map((q: TickerRow) => [q.symbol, q]));

  const displayCurrency = getSetting(SETTING_KEYS.DISPLAY_CURRENCY) ?? 'EUR';

  const results: PositionMetrics[] = [];
  for (const ticker of tickers) {
    const trades = tradesByTicker.get(ticker)!;
    const state = walkTrades(trades);
    const quote = quotesBySym.get(ticker);
    results.push(await metricsFromState(state, quote ?? null, displayCurrency));
  }

  // Sort: open positions first (by market value desc), then closed (by realized desc)
  results.sort((a, b) => {
    if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
    if (a.is_open) return (b.market_value_display ?? 0) - (a.market_value_display ?? 0);
    return b.realized_pnl_display - a.realized_pnl_display;
  });

  return results;
}

async function metricsFromState(
  state: PositionState,
  quote: TickerRow | null,
  displayCurrency: string,
): Promise<PositionMetrics> {
  const sharesOpen = state.open_lots.reduce((s, l) => s + l.shares_remaining, 0);
  const costBasis = state.open_lots.reduce((s, l) => s + l.shares_remaining * l.cost_per_share, 0);
  const avgCost = sharesOpen > 0 ? costBasis / sharesOpen : 0;
  const currentPrice = quote?.last_price ?? null;
  const marketValue = currentPrice != null && sharesOpen > 0 ? sharesOpen * currentPrice : null;
  const unrealized = marketValue != null ? marketValue - costBasis : null;
  const unrealizedPct = unrealized != null && costBasis > 0 ? (unrealized / costBasis) * 100 : null;
  const realized = state.realized.reduce((s, r) => s + r.realized_pnl, 0);
  const totalPnl = unrealized != null ? unrealized + realized : null;

  return {
    ticker: state.ticker,
    name: quote?.name ?? null,
    currency: state.currency,
    shares_open: sharesOpen,
    avg_cost: avgCost,
    cost_basis: costBasis,
    current_price: currentPrice,
    market_value: marketValue,
    unrealized_pnl: unrealized,
    unrealized_pct: unrealizedPct,
    realized_pnl: realized,
    total_pnl: totalPnl,
    total_buys: state.total_buys,
    total_sells: state.total_sells,
    is_open: sharesOpen > 1e-9,

    display_currency: displayCurrency,
    cost_basis_display: await convert(costBasis, state.currency, displayCurrency),
    market_value_display: marketValue != null ? await convert(marketValue, state.currency, displayCurrency) : null,
    unrealized_pnl_display: unrealized != null ? await convert(unrealized, state.currency, displayCurrency) : null,
    realized_pnl_display: await convert(realized, state.currency, displayCurrency),
    total_pnl_display: totalPnl != null ? await convert(totalPnl, state.currency, displayCurrency) : null,
  };
}

export interface PortfolioTotals {
  display_currency: string;
  cost_basis: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  total_pnl: number;
}

export function totalsOf(positions: PositionMetrics[]): PortfolioTotals {
  let costBasis = 0, marketValue = 0, unrealized = 0, realized = 0;
  let displayCurrency = 'EUR';
  for (const p of positions) {
    displayCurrency = p.display_currency;
    costBasis += p.cost_basis_display;
    marketValue += p.market_value_display ?? 0;
    unrealized += p.unrealized_pnl_display ?? 0;
    realized += p.realized_pnl_display;
  }
  return {
    display_currency: displayCurrency,
    cost_basis: costBasis,
    market_value: marketValue,
    unrealized_pnl: unrealized,
    unrealized_pct: costBasis > 0 ? (unrealized / costBasis) * 100 : 0,
    realized_pnl: realized,
    total_pnl: unrealized + realized,
  };
}

/**
 * Return all realized lots across all tickers (for tax / history reporting).
 */
export function allRealizedLots(): RealizedLot[] {
  const tickers = distinctTickers();
  const out: RealizedLot[] = [];
  for (const ticker of tickers) {
    const state = walkTrades(listTrades({ ticker }));
    out.push(...state.realized);
  }
  return out;
}
