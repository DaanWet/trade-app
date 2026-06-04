import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { insertTrade, getTrade, type TradeRow } from "../queries/trades";
import { upsertTicker } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";
import {
  computeAllPositions,
  walkTrades,
  sharesHeld,
  findShareOverdraw,
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
