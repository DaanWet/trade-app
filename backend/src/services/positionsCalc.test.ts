import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { insertTrade } from "../queries/trades";
import { upsertTicker } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";
import { computeAllPositions } from "./positionsCalc";

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
