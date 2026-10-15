import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { insertTrade, getTrade, type TradeRow } from "../queries/trades";
import { upsertTicker, upsertFxRate } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";
import {
  computeAllPositions,
  walkTrades,
  sharesHeld,
  findShareOverdraw,
  totalsOf,
} from "./positionsCalc";

/** Build a TradeRow with sensible defaults; override what the test cares about. */
function row(
  partial: Partial<TradeRow> & Pick<TradeRow, "side" | "shares" | "trade_date">,
): TradeRow {
  return {
    id: partial.id ?? 0,
    ticker: partial.ticker ?? "AAPL",
    trade_date: partial.trade_date,
    side: partial.side,
    shares: partial.shares,
    price: partial.price ?? 100,
    currency: partial.currency ?? "USD",
    fees: partial.fees ?? 0,
    notes: null,
    created_at: "",
  };
}

const openShares = (s: ReturnType<typeof walkTrades>) =>
  s.open_lots.reduce((sum, l) => sum + l.shares_remaining, 0);

// EUR amounts convert 1:1 (no provider call). Seeding a fresh `tickers` row makes
// fetchQuotes a pure cache hit (last_price_at within the 5-min TTL → no network).

function seedFreshQuote(symbol: string, last_price: number | null, currency = "EUR") {
  upsertTicker({
    symbol,
    name: symbol,
    currency,
    last_price,
    last_price_at: new Date().toISOString(),
  });
}

async function positionFor(ticker: string) {
  const positions = await computeAllPositions();
  const found = positions.find((p) => p.ticker === ticker.toUpperCase());
  if (!found) throw new Error(`no position for ${ticker}`);
  return found;
}

beforeEach(() => {
  db.exec(`DELETE FROM trades; DELETE FROM fx_rates; DELETE FROM daily_prices; DELETE FROM tickers;`);
  upsertSetting(SETTING_KEYS.DISPLAY_CURRENCY, "EUR");
});

describe("computeAllPositions — total P&L", () => {
  it("a fully closed position reports total P&L equal to its realized P&L", async () => {
    seedFreshQuote("CLOSED", 999); // price is irrelevant: no open shares left
    insertTrade({ ticker: "CLOSED", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "CLOSED", trade_date: "2026-03-01", side: "SELL", shares: 10, price: 130, currency: "EUR", fees: 0 });

    const p = await positionFor("CLOSED");
    expect(p.is_open).toBe(false);
    expect(p.realized_pnl_display).toBeCloseTo(300, 6); // 1300 - 1000
    // A closed position has no unrealized component, so its total IS its realized P&L.
    expect(p.total_pnl_display).toBeCloseTo(300, 6);
    expect(p.total_pnl).toBeCloseTo(300, 6);
  });

  it("an open position adds unrealized to realized", async () => {
    seedFreshQuote("OPEN", 150);
    insertTrade({ ticker: "OPEN", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    // Sell half: realized = 5*(130-100) = 150. Remaining 5 open at cost 100, priced 150 → unrealized 250.
    insertTrade({ ticker: "OPEN", trade_date: "2026-03-01", side: "SELL", shares: 5, price: 130, currency: "EUR", fees: 0 });

    const p = await positionFor("OPEN");
    expect(p.is_open).toBe(true);
    expect(p.realized_pnl_display).toBeCloseTo(150, 6);
    expect(p.unrealized_pnl_display).toBeCloseTo(250, 6); // 5*150 - 5*100
    expect(p.total_pnl_display).toBeCloseTo(400, 6); // 150 + 250
  });

  it("an open position with no available quote leaves total P&L unknown (null)", async () => {
    // Fresh row but null price → cache hit (no network), yet no usable quote.
    seedFreshQuote("NOQUOTE", null);
    insertTrade({ ticker: "NOQUOTE", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const p = await positionFor("NOQUOTE");
    expect(p.is_open).toBe(true);
    expect(p.current_price).toBeNull();
    expect(p.unrealized_pnl_display).toBeNull();
    // Unrealized is genuinely unknown here, so total must stay null — not silently 0.
    expect(p.total_pnl_display).toBeNull();
    expect(p.total_pnl).toBeNull();
  });
});

describe("walkTrades — oversold detection (pure)", () => {
  it("reports no oversold when a SELL stays within the open lots", () => {
    const state = walkTrades([
      row({ id: 1, side: "BUY", shares: 10, trade_date: "2026-01-01" }),
      row({ id: 2, side: "SELL", shares: 5, trade_date: "2026-01-02" }),
    ]);
    expect(state.oversold).toBe(0);
    expect(openShares(state)).toBe(5);
  });

  it("reports the excess when a SELL exceeds the open lots", () => {
    const state = walkTrades([
      row({ id: 1, side: "BUY", shares: 10, trade_date: "2026-01-01" }),
      row({ id: 2, side: "SELL", shares: 15, trade_date: "2026-01-02" }),
    ]);
    expect(state.oversold).toBe(5);
  });

  it("reports no oversold when a SELL closes the position exactly", () => {
    const state = walkTrades([
      row({ id: 1, side: "BUY", shares: 10, trade_date: "2026-01-01" }),
      row({ id: 2, side: "SELL", shares: 10, trade_date: "2026-01-02" }),
    ]);
    expect(state.oversold).toBe(0);
    expect(openShares(state)).toBe(0);
  });

  it("matches a SELL across multiple FIFO lots without oversold", () => {
    const state = walkTrades([
      row({ id: 1, side: "BUY", shares: 5, trade_date: "2026-01-01" }),
      row({ id: 2, side: "BUY", shares: 5, trade_date: "2026-01-02" }),
      row({ id: 3, side: "SELL", shares: 8, trade_date: "2026-01-03" }),
    ]);
    expect(state.oversold).toBe(0);
    expect(openShares(state)).toBe(2);
  });

  it("flags a SELL processed before its covering BUY (back-dated short)", () => {
    // walkTrades processes in array order; callers sort chronologically first, so a
    // SELL ahead of its covering BUY has no open lots to match.
    const state = walkTrades([
      row({ id: 1, side: "SELL", shares: 5, trade_date: "2026-01-01" }),
      row({ id: 2, side: "BUY", shares: 10, trade_date: "2026-01-02" }),
    ]);
    expect(state.oversold).toBe(5);
    expect(openShares(state)).toBe(10); // the later BUY still opens its lot
  });
});

describe("sharesHeld + findShareOverdraw (DB-backed)", () => {
  it("sharesHeld returns open shares, honouring asOf and excludeTradeId", () => {
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    const sell = insertTrade({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 4, price: 120, currency: "EUR", fees: 0 });

    expect(sharesHeld("AAPL")).toBe(6); // 10 bought − 4 sold
    expect(sharesHeld("AAPL", { asOf: "2026-01-15" })).toBe(10); // before the SELL
    expect(sharesHeld("AAPL", { excludeTradeId: sell.id })).toBe(10); // ignore the SELL
    expect(sharesHeld("MISSING")).toBe(0);
  });

  it("blocks a new SELL that exceeds shares held", () => {
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const ok = findShareOverdraw({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 10, price: 120, currency: "EUR", fees: 0 }, null);
    expect(ok).toBeNull();

    const bad = findShareOverdraw({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 11, price: 120, currency: "EUR", fees: 0 }, null);
    expect(bad).not.toBeNull();
    expect(bad!.ticker).toBe("AAPL");
    expect(bad!.shares_held).toBe(10);
    expect(bad!.oversold).toBeCloseTo(1, 9);
  });

  it("blocks a back-dated SELL placed before the covering BUY", () => {
    insertTrade({ ticker: "AAPL", trade_date: "2026-02-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const bad = findShareOverdraw({ ticker: "AAPL", trade_date: "2026-01-01", side: "SELL", shares: 5, price: 120, currency: "EUR", fees: 0 }, null);
    expect(bad).not.toBeNull();
    expect(bad!.oversold).toBeCloseTo(5, 9);
  });

  it("blocks deleting a BUY that leaves a later SELL uncovered", () => {
    const buy = insertTrade({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 10, price: 120, currency: "EUR", fees: 0 });

    const previous = getTrade(buy.id)!;
    const bad = findShareOverdraw(null, previous); // simulate DELETE of the BUY
    expect(bad).not.toBeNull();
    expect(bad!.oversold).toBeCloseTo(10, 9);
  });

  it("allows deleting a SELL (raises holdings, never a short)", () => {
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    const sell = insertTrade({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 4, price: 120, currency: "EUR", fees: 0 });

    const previous = getTrade(sell.id)!;
    expect(findShareOverdraw(null, previous)).toBeNull();
  });

  it("blocks editing a BUY down so a later SELL no longer fits", () => {
    const buy = insertTrade({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 8, price: 120, currency: "EUR", fees: 0 });

    const previous = getTrade(buy.id)!;
    // Shrink the BUY from 10 → 5 shares: the SELL of 8 now oversells by 3.
    const bad = findShareOverdraw({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 5, price: 100, currency: "EUR", fees: 0 }, previous);
    expect(bad).not.toBeNull();
    expect(bad!.oversold).toBeCloseTo(3, 9);
  });
});

// ---------------------------------------------------------------------------
// Issue #10: a trade booked in a currency other than the one the stock quotes in.
// The live quote is in the instrument's currency; treating it as if it were already
// in the trade currency silently mis-values the whole position.
// ---------------------------------------------------------------------------
describe("computeAllPositions — trade currency differs from quote currency", () => {
  const today = new Date().toISOString().slice(0, 10);

  /** USD→EUR at 0.9, on both the buy date and today, so no provider call is needed. */
  function seedUsdEurRate(...dates: string[]) {
    for (const rate_date of dates) {
      upsertFxRate({ base: "USD", quote: "EUR", rate_date, rate: 0.9 });
    }
  }

  it("values a EUR-booked buy of a USD-quoted stock at the converted market price", async () => {
    seedUsdEurRate(today, "2026-01-05");
    seedFreshQuote("AAPL", 200, "USD");
    // The user paid EUR 1000 in total; the market now says 10 × $200 = $2000.
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const p = await positionFor("AAPL");
    expect(p.currency).toBe("EUR");       // what was paid
    expect(p.quote_currency).toBe("USD"); // what current_price is denominated in
    expect(p.current_price).toBe(200);    // left in USD, unconverted

    // $2000 × 0.9 = EUR 1800, against an EUR 1000 cost basis.
    expect(p.cost_basis_display).toBeCloseTo(1000, 6);
    expect(p.market_value_display).toBeCloseTo(1800, 6);
    expect(p.unrealized_pnl_display).toBeCloseTo(800, 6);
  });

  it("states native market_value in the trade currency so it is comparable to cost_basis", async () => {
    seedUsdEurRate(today, "2026-01-05");
    seedFreshQuote("AAPL", 200, "USD");
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const p = await positionFor("AAPL");
    expect(p.market_value).toBeCloseTo(1800, 6);   // EUR, not the raw $2000
    expect(p.unrealized_pnl).toBeCloseTo(800, 6);
    expect(p.unrealized_pct).toBeCloseTo(80, 6);   // 800 / 1000
  });

  it("leaves a matching-currency position exactly as before (no conversion applied)", async () => {
    seedFreshQuote("MSFT", 150, "EUR");
    insertTrade({ ticker: "MSFT", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const p = await positionFor("MSFT");
    expect(p.currency).toBe("EUR");
    expect(p.quote_currency).toBe("EUR");
    expect(p.market_value).toBeCloseTo(1500, 6);
    expect(p.market_value_display).toBeCloseTo(1500, 6);
    expect(p.unrealized_pnl_display).toBeCloseTo(500, 6);
  });

  it("falls back to the trade currency when the quote names no currency", async () => {
    upsertTicker({ symbol: "NOCUR", name: "NOCUR", currency: null, last_price: 150, last_price_at: new Date().toISOString() });
    insertTrade({ ticker: "NOCUR", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const p = await positionFor("NOCUR");
    expect(p.quote_currency).toBe("EUR");
    expect(p.market_value_display).toBeCloseTo(1500, 6);
  });
});

describe("computeAllPositions — day P&L", () => {
  const today = new Date().toISOString().slice(0, 10);

  /** Quote with a previous close, fresh enough to skip the provider. */
  function seedQuoteWithPrevious(
    symbol: string,
    last_price: number | null,
    previous_close: number | null,
    currency = "EUR",
  ) {
    upsertTicker({
      symbol,
      name: symbol,
      currency,
      last_price,
      previous_close,
      last_price_at: new Date().toISOString(),
    });
  }

  it("values the move since the previous close on the shares currently held", async () => {
    seedQuoteWithPrevious("AAPL", 110, 100);
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 80, currency: "EUR", fees: 0 });

    const p = await positionFor("AAPL");
    expect(p.previous_close).toBe(100);
    expect(p.day_pnl_display).toBeCloseTo(100, 6); // 10 × (110 − 100)
    expect(p.day_pnl_pct).toBeCloseTo(10, 6);      // the price moved 10%, not the position's P&L
  });

  it("converts from the quote currency, not the trade currency", async () => {
    upsertFxRate({ base: "USD", quote: "EUR", rate_date: today, rate: 0.9 });
    upsertFxRate({ base: "USD", quote: "EUR", rate_date: "2026-01-05", rate: 0.9 });
    seedQuoteWithPrevious("NVDA", 110, 100, "USD");
    // Booked in EUR, quoted in USD: the $100 day move is worth €90.
    insertTrade({ ticker: "NVDA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 80, currency: "EUR", fees: 0 });

    const p = await positionFor("NVDA");
    expect(p.day_pnl_display).toBeCloseTo(90, 6);
    expect(p.day_pnl_pct).toBeCloseTo(10, 6); // a percentage is currency-free
  });

  it("reports an unknown day P&L as null rather than zero", async () => {
    seedQuoteWithPrevious("NOPREV", 110, null);
    insertTrade({ ticker: "NOPREV", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 80, currency: "EUR", fees: 0 });

    const p = await positionFor("NOPREV");
    expect(p.previous_close).toBeNull();
    expect(p.day_pnl_display).toBeNull();
    expect(p.day_pnl_pct).toBeNull();
  });

  it("gives a closed position no day P&L — there are no shares left to move", async () => {
    seedQuoteWithPrevious("CLOSED", 110, 100);
    insertTrade({ ticker: "CLOSED", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 80, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "CLOSED", trade_date: "2026-02-05", side: "SELL", shares: 10, price: 120, currency: "EUR", fees: 0 });

    const p = await positionFor("CLOSED");
    expect(p.is_open).toBe(false);
    expect(p.day_pnl_display).toBeNull();
  });
});

describe("totalsOf — day P&L", () => {
  function seedQuoteWithPrevious(symbol: string, last_price: number, previous_close: number | null) {
    upsertTicker({
      symbol,
      name: symbol,
      currency: "EUR",
      last_price,
      previous_close,
      last_price_at: new Date().toISOString(),
    });
  }

  it("sums the priced positions and states the move as a percentage of yesterday's value", async () => {
    seedQuoteWithPrevious("AAA", 110, 100); // 10 × +10 = +100, yesterday worth 1000
    seedQuoteWithPrevious("BBB", 90, 100);  // 10 × −10 = −100, yesterday worth 1000
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "BBB", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", fees: 0 });

    const totals = totalsOf(await computeAllPositions());
    expect(totals.day_pnl).toBeCloseTo(0, 6);
    expect(totals.day_pnl_pct).toBeCloseTo(0, 6);
    expect(totals.day_pnl_partial).toBe(false);
  });

  it("flags the total as partial when an open position has no previous close", async () => {
    seedQuoteWithPrevious("AAA", 110, 100);
    seedQuoteWithPrevious("BBB", 90, null);
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "BBB", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", fees: 0 });

    const totals = totalsOf(await computeAllPositions());
    expect(totals.day_pnl).toBeCloseTo(100, 6); // only what could be priced
    expect(totals.day_pnl_partial).toBe(true);
  });

  it("reports no day P&L at all when nothing could be priced", async () => {
    seedQuoteWithPrevious("AAA", 110, null);
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", fees: 0 });

    const totals = totalsOf(await computeAllPositions());
    expect(totals.day_pnl).toBeNull();
    expect(totals.day_pnl_pct).toBeNull();
  });
});

describe("computeAllPositions — average buy and sell price of the sold shares", () => {
  it("reports what a fully closed position was bought and sold at", async () => {
    seedFreshQuote("CLOSED", 999); // irrelevant: nothing left to price
    insertTrade({ ticker: "CLOSED", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "CLOSED", trade_date: "2026-03-01", side: "SELL", shares: 10, price: 130, currency: "EUR", fees: 0 });

    const p = await positionFor("CLOSED");
    expect(p.avg_realized_cost).toBeCloseTo(100, 6);
    expect(p.avg_realized_sell).toBeCloseTo(130, 6);
    // avg_cost stays what it always was: the average of the OPEN shares, of which there are none.
    expect(p.avg_cost).toBe(0);
  });

  it("averages across several buys and sells at different prices", async () => {
    seedFreshQuote("MIX", 100);
    insertTrade({ ticker: "MIX", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "MIX", trade_date: "2026-02-05", side: "BUY", shares: 10, price: 200, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "MIX", trade_date: "2026-03-01", side: "SELL", shares: 5, price: 300, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "MIX", trade_date: "2026-04-01", side: "SELL", shares: 15, price: 400, currency: "EUR", fees: 0 });

    const p = await positionFor("MIX");
    // FIFO: the 20 sold shares are the 10 @ 100 plus the 10 @ 200 → (1000 + 2000) / 20.
    expect(p.avg_realized_cost).toBeCloseTo(150, 6);
    // 5 @ 300 then 15 @ 400 → (1500 + 6000) / 20.
    expect(p.avg_realized_sell).toBeCloseTo(375, 6);
  });

  it("covers only the sold shares, leaving avg_cost about the ones still held", async () => {
    seedFreshQuote("PART", 100);
    insertTrade({ ticker: "PART", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "PART", trade_date: "2026-02-05", side: "BUY", shares: 10, price: 300, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "PART", trade_date: "2026-03-01", side: "SELL", shares: 10, price: 500, currency: "EUR", fees: 0 });

    const p = await positionFor("PART");
    expect(p.is_open).toBe(true);
    expect(p.avg_realized_cost).toBeCloseTo(100, 6); // FIFO sold the cheap lot
    expect(p.avg_realized_sell).toBeCloseTo(500, 6);
    expect(p.avg_cost).toBeCloseTo(300, 6); // the expensive lot is what is left
  });

  it("folds fees in the same direction they hit you", async () => {
    seedFreshQuote("FEES", 100);
    insertTrade({ ticker: "FEES", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 50 });
    insertTrade({ ticker: "FEES", trade_date: "2026-03-01", side: "SELL", shares: 10, price: 130, currency: "EUR", fees: 30 });

    const p = await positionFor("FEES");
    expect(p.avg_realized_cost).toBeCloseTo(105, 6); // (1000 + 50) / 10 — buying cost more
    expect(p.avg_realized_sell).toBeCloseTo(127, 6); // (1300 − 30) / 10 — selling yielded less
  });

  it("has neither for a position that was never sold", async () => {
    seedFreshQuote("HELD", 100);
    insertTrade({ ticker: "HELD", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });

    const p = await positionFor("HELD");
    expect(p.avg_realized_cost).toBeNull();
    expect(p.avg_realized_sell).toBeNull();
  });
});

// Issue #4: the chart's ticker filter groups positions by instrument type.
describe("computeAllPositions — quote type", () => {
  it("carries the instrument type from the tickers cache", async () => {
    upsertTicker({
      symbol: "VWCE",
      name: "VWCE",
      currency: "EUR",
      last_price: 100,
      last_price_at: new Date().toISOString(),
      quote_type: "ETF",
    });
    insertTrade({ ticker: "VWCE", trade_date: "2026-01-05", side: "BUY", shares: 1, price: 90, currency: "EUR", fees: 0 });

    expect((await positionFor("VWCE")).quote_type).toBe("ETF");
  });

  it("leaves the type null when the cache doesn't know it", async () => {
    seedFreshQuote("AAA", 10);
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 1, price: 10, currency: "EUR", fees: 0 });

    expect((await positionFor("AAA")).quote_type).toBeNull();
  });
});
