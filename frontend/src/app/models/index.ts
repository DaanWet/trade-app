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
  market_value: number;
  invested: number;
  pnl: number;
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
  currency: string;
}

export interface TaxYearReport {
  year: number;
  gains: number;
  losses: number;
  net_gain_pretax: number;
  exemption: number;
  taxable_amount: number;
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
