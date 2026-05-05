/**
 * Pluggable interfaces for external market-data providers.
 *
 * The app code (`fxService`, `marketData`) depends on these abstractions, not on
 * any specific vendor. Swapping a provider (Yahoo → Tiingo, Frankfurter → ECB direct,
 * etc.) means only writing a new implementation of the relevant interface.
 *
 * Conventions:
 *  - All dates are ISO 'YYYY-MM-DD' strings unless explicitly typed as Date.
 *  - All currency codes are ISO 4217, uppercase.
 *  - Implementations should NOT throw on "no data found" — return null/empty.
 *  - Implementations MAY throw on transport errors (network, auth) — callers wrap with try/catch.
 */

// --- FX -------------------------------------------------------------------

export interface FxRangePoint {
  date: string;
  rate: number;
}

export interface FxProvider {
  /** Human-readable provider name, used in logs. */
  readonly name: string;

  /**
   * Fetch a single rate for one base→quote pair on a given date.
   * Returns null if the provider has no rate for that date (e.g. weekend).
   */
  fetchRate(base: string, quote: string, date: string): Promise<number | null>;

  /**
   * Fetch all rates in a date range in one call (where the provider supports it).
   * Implementations that only support per-day queries can iterate, but the
   * built-in default fxService warming assumes one round-trip per pair.
   */
  fetchRange(base: string, quote: string, from: Date, to: Date): Promise<FxRangePoint[]>;
}

// --- Stock prices ---------------------------------------------------------

export interface PriceQuote {
  symbol: string;
  name: string | null;
  currency: string | null;
  last_price: number | null;
  exchange: string | null;
  quote_type: string | null;
}

export interface PriceClose {
  date: string;
  close: number;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
}

export interface PriceProvider {
  /** Human-readable provider name, used in logs. */
  readonly name: string;

  /** Live (or near-live) quote for a single symbol. */
  fetchQuote(symbol: string): Promise<PriceQuote | null>;

  /** Daily closes between two dates (inclusive on `from`, exclusive on `to`+1). */
  fetchHistorical(symbol: string, from: Date, to: Date): Promise<PriceClose[]>;

  /** Symbol search by name or partial symbol (autocomplete). */
  search(query: string): Promise<SymbolSearchResult[]>;
}
