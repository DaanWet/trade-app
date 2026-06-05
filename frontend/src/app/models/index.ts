export type TradeSide = 'BUY' | 'SELL';

export interface Trade {
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

export interface PositionMetrics {
  ticker: string;
  name: string | null;
  currency: string;
  shares_open: number;
  avg_cost: number;
  cost_basis: number;
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pct: number | null;
  realized_pnl: number;
  total_pnl: number | null;
  total_buys: number;
  total_sells: number;
  is_open: boolean;

  display_currency: string;
  cost_basis_display: number;
  market_value_display: number | null;
  unrealized_pnl_display: number | null;
  realized_pnl_display: number;
  total_pnl_display: number | null;
}

export interface PortfolioTotals {
  display_currency: string;
  cost_basis: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  total_pnl: number;

  cash_balance: number;
  net_worth: number;
  cash_pct: number;
  invested_pct: number;
}

export type CashTxType = 'DEPOSIT' | 'WITHDRAWAL';

export interface CashTransaction {
  id: number;
  type: CashTxType;
  amount: number;
  currency: string;
  tx_date: string;
  notes: string | null;
  created_at: string;
}

export interface CashInput {
  type: CashTxType;
  amount: number;
  currency: string;
  tx_date: string;
  notes?: string | null;
}

export interface CashSummary {
  display_currency: string;
  net_deposits: number;
  invested: number;
  cash_balance: number;
}

export interface CashResponse {
  transactions: CashTransaction[];
  summary: CashSummary;
}

export interface PositionsResponse {
  positions: PositionMetrics[];
  totals: PortfolioTotals;
}

/** Open shares held for a ticker (GET /api/positions/holdings). */
export interface Holdings {
  ticker: string;
  shares_held: number;
}

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

export interface PortfolioPoint {
  date: string;
  market_value: number; // stocks only
  cash: number; // cash balance that day
  total: number; // market_value + cash
  net_deposits: number; // cumulative net deposits
}

export interface TickerSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
}

export interface TickerQuote {
  symbol: string;
  name: string | null;
  currency: string | null;
  last_price: number | null;
  last_price_at: string | null;
  exchange: string | null;
  quote_type: string | null;
}

export interface TaxParams {
  rate: number;
  exemption: number;
  appliesFrom: number;
  fotomomentDate: string; // snapshot date (last day before appliesFrom), e.g. 2025-12-31
  currency: string;
}

export interface TaxYearReport {
  year: number;
  gains: number;
  losses: number;
  net_gain_pretax: number; // gains − losses (same-year losses netted)
  exemption: number;
  taxable_amount: number; // max(0, net_gain_pretax − exemption) when the year applies
  tax_due: number;
  rate: number;
  currency: string;
  num_realized_lots: number;
  applies: boolean;
}

export interface TaxReport {
  params: TaxParams;
  years: TaxYearReport[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One entry from the backend's in-memory log ring buffer (GET /api/diagnostics). */
export interface DiagnosticsEvent {
  ts: string;
  level: LogLevel;
  component: string;
  message: string;
  errorName?: string;
}

/** GET /api/diagnostics — recent backend events + scrubbed metadata (local-only). */
export interface DiagnosticsResponse {
  appVersion: string;
  now: string;
  logFilePath: string;
  counters: {
    convertFailures: number;
    rateLimited: string[];
  };
  settings: Record<string, string>;
  recentEvents: DiagnosticsEvent[];
}

/** Which cost basis produced a lot's taxable result. */
export type TaxBasis = 'none' | 'purchase' | 'fotomoment' | 'shielded';

export interface TaxLot extends RealizedLot {
  year: number;
  taxable: boolean;
  cost_basis_display: number;
  proceeds_display: number;
  realized_pnl_display: number; // economic P&L: S − P
  fotomoment_value_display: number | null; // F = close(31/12) × shares, null if N/A
  taxable_pnl_display: number; // fotomoment-adjusted taxable gain/loss
  basis_used: TaxBasis;
}
