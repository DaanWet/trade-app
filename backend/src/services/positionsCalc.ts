import { listTrades, distinctTickers, type TradeRow } from '../queries/trades';
import { fetchQuotes } from './marketData';
import { convert } from './fxService';
import { getSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';
import { logger } from '../helpers/logger';
import type { TickerRow } from '../queries/prices';

/** A position counts as open above this many shares (ignores floating-point dust). */
const OPEN_SHARES_EPSILON = 1e-9;

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
  /** Shares sold beyond the open lots at some point in the walk (a short). 0 when clean. */
  oversold: number;
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
  let oversold = 0;

  for (const t of trades) {
    if (t.currency !== currency) {
      logger.warn('positions', `${ticker} has mixed currencies (${currency} vs ${t.currency}); using first.`);
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
      oversold += sharesToClose;
      logger.warn('positions', `${ticker} sold ${t.shares} on ${t.trade_date} but only ${t.shares - sharesToClose} were covered by open lots. Short positions are not modeled.`);
    }
  }

  return { ticker, currency, open_lots: openLots, realized, total_buys: totalBuys, total_sells: totalSells, oversold };
}

/** Below this many shares a short is just floating-point dust, not a real overdraw. */
const SHARE_EPSILON = 1e-9;

/** The fields the FIFO walk needs from a not-yet-persisted (incoming) trade. */
export type TradeShareFields = Pick<
  TradeRow,
  'ticker' | 'trade_date' | 'side' | 'shares' | 'price' | 'currency' | 'fees'
>;

/** Total open shares left after a walk. */
function openSharesOf(state: PositionState): number {
  return state.open_lots.reduce((sum, lot) => sum + lot.shares_remaining, 0);
}

/** Order a trade list exactly like the DB does (trade_date ASC, id ASC). */
function sortChronologically(trades: TradeRow[]): TradeRow[] {
  return [...trades].sort((a, b) =>
    a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : a.id - b.id,
  );
}

/** Materialize an incoming trade as a TradeRow so it can join the FIFO walk. */
function syntheticTradeRow(fields: TradeShareFields, id: number): TradeRow {
  return {
    id,
    ticker: fields.ticker,
    trade_date: fields.trade_date,
    side: fields.side,
    shares: fields.shares,
    price: fields.price,
    currency: fields.currency,
    fees: fields.fees,
    notes: null,
    created_at: '',
  };
}

/**
 * Open shares held for a ticker as of `asOf` (inclusive), optionally excluding one
 * trade id (so the trade-form can show availability while editing that very trade).
 * Reads trades from SQLite only — no live quotes.
 */
export function sharesHeld(
  ticker: string,
  opts?: { asOf?: string; excludeTradeId?: number },
): number {
  let trades = listTrades({ ticker });
  if (opts?.excludeTradeId != null) trades = trades.filter((t) => t.id !== opts.excludeTradeId);
  if (opts?.asOf) trades = trades.filter((t) => t.trade_date <= opts.asOf!);
  if (trades.length === 0) return 0;
  return openSharesOf(walkTrades(trades));
}

/**
 * Re-simulate FIFO for every ticker a trade change touches and return the first one
 * whose history would go short — a SELL closing more shares than were open at that
 * point in time (the walk is chronological, so a back-dated SELL counts too). Returns
 * null when every affected ticker stays covered.
 *
 * `next` is the new/edited row (null when deleting); `previous` is the existing row
 * being replaced or removed. Mirrors projectCashAfterTrade's (next, previous) shape.
 */
export function findShareOverdraw(
  next: TradeShareFields | null,
  previous?: TradeRow | null,
): { ticker: string; shares_held: number; oversold: number } | null {
  const tickers = new Set<string>();
  if (next) tickers.add(next.ticker);
  if (previous) tickers.add(previous.ticker);

  for (const ticker of tickers) {
    const replacesHere = !!previous && previous.ticker === ticker;
    // Holdings as they stand without the change (listTrades is already sorted, and a
    // filter preserves that order). Back out the previous version of the edited/deleted row.
    let base = listTrades({ ticker });
    if (replacesHere) base = base.filter((t) => t.id !== previous!.id);

    // The same history with the new/edited row applied. Reuse previous.id on an edit so
    // it keeps its slot; a fresh insert sorts last on its date (highest id).
    const projected =
      next && next.ticker === ticker
        ? sortChronologically([
            ...base,
            syntheticTradeRow(next, replacesHere ? previous!.id : Number.MAX_SAFE_INTEGER),
          ])
        : base;

    const oversold = projected.length ? walkTrades(projected).oversold : 0;
    if (oversold > SHARE_EPSILON) {
      // shares_held is what you actually hold, ignoring the rejected change.
      return { ticker, shares_held: base.length ? openSharesOf(walkTrades(base)) : 0, oversold };
    }
  }
  return null;
}

/** User-facing (nl-BE) message for a blocked share overdraw, shared by the route. */
export function shareShortfallMessage(o: {
  ticker: string;
  shares_held: number;
  oversold: number;
}): string {
  return `Onvoldoende aandelen: je bezit er ${o.shares_held} van ${o.ticker}, dit zou je ${o.oversold} aandelen short zetten.`;
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
  const sharesOpen = openSharesOf(state);
  const costBasis = state.open_lots.reduce((s, l) => s + l.shares_remaining * l.cost_per_share, 0);
  const avgCost = sharesOpen > 0 ? costBasis / sharesOpen : 0;
  const currentPrice = quote?.last_price ?? null;
  const marketValue = currentPrice != null && sharesOpen > 0 ? sharesOpen * currentPrice : null;
  const unrealized = marketValue != null ? marketValue - costBasis : null;
  const unrealizedPct = unrealized != null && costBasis > 0 ? (unrealized / costBasis) * 100 : null;
  const realized = state.realized.reduce((s, r) => s + r.realized_pnl, 0);
  const isOpen = sharesOpen > OPEN_SHARES_EPSILON;
  // A closed position (no open shares) has no unrealized component, so its total P&L
  // is simply its realized P&L. An open position with no available quote leaves the
  // unrealized — and therefore the total — genuinely unknown (null), never silently 0.
  const totalPnl =
    unrealized != null ? unrealized + realized : isOpen ? null : realized;

  // Display-currency conversions are date-aware:
  //  - cost_basis_display: each open lot converted with its BUY date
  //  - realized_pnl_display: each realized lot converted with its SELL date
  //  - market_value_display: today's rate (it IS today's market value)
  //  - unrealized / total: derived from the above for internal consistency
  const costBasisDisplay = await sumConverted(
    state.open_lots.map(l => ({
      amount: l.shares_remaining * l.cost_per_share,
      currency: state.currency,
      date: l.trade_date,
    })),
    displayCurrency,
  );
  const realizedDisplay = await sumConverted(
    state.realized.map(r => ({
      amount: r.realized_pnl,
      currency: r.currency,
      date: r.sell_date,
    })),
    displayCurrency,
  );
  const marketValueDisplay = marketValue != null ? await convert(marketValue, state.currency, displayCurrency) : null;
  const unrealizedDisplay = marketValueDisplay != null ? marketValueDisplay - costBasisDisplay : null;
  const totalPnlDisplay =
    unrealizedDisplay != null
      ? unrealizedDisplay + realizedDisplay
      : isOpen
        ? null
        : realizedDisplay;

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
    is_open: isOpen,

    display_currency: displayCurrency,
    cost_basis_display: costBasisDisplay,
    market_value_display: marketValueDisplay,
    unrealized_pnl_display: unrealizedDisplay,
    realized_pnl_display: realizedDisplay,
    total_pnl_display: totalPnlDisplay,
  };
}

/** Helper: convert each entry with its own date and sum the result. */
async function sumConverted(
  entries: Array<{ amount: number; currency: string; date: string }>,
  displayCurrency: string,
): Promise<number> {
  let total = 0;
  for (const e of entries) {
    total += await convert(e.amount, e.currency, displayCurrency, e.date);
  }
  return total;
}

/** Stock-only portfolio totals (what totalsOf computes from positions). */
export interface StockTotals {
  display_currency: string;
  cost_basis: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  total_pnl: number;
}

/** Cash + net-worth allocation, layered on top by the positions route via cashService. */
export interface CashAllocation {
  cash_balance: number;
  net_worth: number; // market_value + cash_balance
  cash_pct: number; // share of net worth held in cash (clamped to [0,100])
  invested_pct: number; // share of net worth held in stocks (clamped to [0,100])
}

export type PortfolioTotals = StockTotals & CashAllocation;

export function totalsOf(positions: PositionMetrics[]): StockTotals {
  let costBasis = 0, marketValue = 0, unrealized = 0, realized = 0;
  let displayCurrency = 'EUR';
  // A closed position contributes only its realized P&L (its market/unrealized are null →
  // coalesced to 0 here). An unpriced open position's unknown unrealized likewise coalesces
  // to 0, so the aggregate total_pnl below is realized + whatever unrealized we could price.
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
