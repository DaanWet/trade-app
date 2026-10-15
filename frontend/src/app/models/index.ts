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
  /** Handelsmunt: waarin de trades geboekt zijn (avg_cost, cost_basis, market_value). */
  currency: string;
  /** Noteringsmunt: waarin de beurs het aandeel quoteert. Enkel current_price staat hierin. */
  quote_currency: string;
  /** Soort instrument uit de ticker-cache (EQUITY, ETF, FUTURE, …). Null als onbekend. */
  quote_type: string | null;
  name: string | null;
  shares_open: number;
  avg_cost: number;
  /** Wat de reeds verkochte aandelen je kostten, per aandeel. Null als er niets verkocht is. */
  avg_realized_cost: number | null;
  /** Wat diezelfde aandelen opbrachten, per aandeel, na verkoopkosten. */
  avg_realized_sell: number | null;
  cost_basis: number;
  current_price: number | null;
  /** Vorige slotkoers, ook in de noteringsmunt. Null als die onbekend is. */
  previous_close: number | null;
  /** Wanneer current_price voor het laatst succesvol is opgehaald (ISO8601). */
  price_as_of: string | null;
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
  /** Beweging sinds de vorige slotkoers op de aandelen die je nu aanhoudt. */
  day_pnl_display: number | null;
  /** Hoeveel de koers zelf sinds de vorige slotkoers bewoog, in procent. */
  day_pnl_pct: number | null;
}

export interface PortfolioTotals {
  display_currency: string;
  cost_basis: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  total_pnl: number;
  /** Beweging van vandaag over de posities die geprijsd konden worden; null als geen enkele. */
  day_pnl: number | null;
  day_pnl_pct: number | null;
  /** True als een open positie geen vorige slotkoers had — day_pnl dekt dan maar een deel. */
  day_pnl_partial: boolean;

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

export interface TickerSlice {
  value: number; // marktwaarde die dag (0 na volledige verkoop of zonder koers)
  invested: number; // netto erin gestoken tot die dag (aankopen − verkopen, kosten inbegrepen)
}

export interface PortfolioPoint {
  date: string;
  market_value: number; // stocks only
  cash: number; // cash balance that day
  total: number; // market_value + cash
  net_deposits: number; // cumulative net deposits
  /** Per ticker vanaf zijn eerste trade — voedt het tickerfilter van de grafiek. */
  by_ticker: Record<string, TickerSlice>;
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
