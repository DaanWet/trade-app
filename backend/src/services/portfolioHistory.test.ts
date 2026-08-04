import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { insertTrade } from "../queries/trades";
import { insertCashTx } from "../queries/cash";
import { upsertDailyPrice, upsertTicker } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";
import { buildPortfolioHistory } from "./portfolioHistory";

// EUR amounts convert 1:1 (no FX provider call) and seeded daily_prices make
// fetchHistorical a pure cache hit — so these assertions never touch the network.
// The multi-currency cases below do need a rate: warmHistoricalRates always calls
// fetchRange (it warms rather than reads cache), so the providers are stubbed. Every
// EUR-only test leaves both stubs untouched.
const USD_EUR = 0.9;
vi.mock("./providers", () => ({
  fxProvider: {
    name: "stub-fx",
    fetchRate: vi.fn(async () => USD_EUR),
    fetchRange: vi.fn(async (base: string, quote: string, from: Date) => {
      if (base !== "USD" || quote !== "EUR") return [];
      return [{ date: from.toISOString().slice(0, 10), rate: USD_EUR }];
    }),
  },
  priceProvider: {
    name: "stub-price",
    fetchQuote: vi.fn(async () => null),
    fetchHistorical: vi.fn(async () => []),
    search: vi.fn(async () => []),
  },
}));

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  db.exec(`DELETE FROM trades; DELETE FROM cash_transactions; DELETE FROM daily_prices; DELETE FROM fx_rates; DELETE FROM tickers;`);
  upsertSetting(SETTING_KEYS.DISPLAY_CURRENCY, "EUR");
});

describe("buildPortfolioHistory", () => {
  it("is empty with no trades and no cash transactions", async () => {
    expect(await buildPortfolioHistory()).toEqual([]);
  });

  it("builds a cash-only point from a deposit (no trades, no Yahoo)", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    const out = await buildPortfolioHistory();
    expect(out).toEqual([
      { date: "2026-01-02", market_value: 0, cash: 1000, total: 1000, net_deposits: 1000 },
    ]);
  });

  it("nets a later withdrawal against the deposit", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    insertCashTx({ type: "WITHDRAWAL", amount: 300, currency: "EUR", tx_date: "2026-02-01" });
    const out = await buildPortfolioHistory();
    expect(out).toEqual([
      { date: "2026-01-02", market_value: 0, cash: 1000, total: 1000, net_deposits: 1000 },
      { date: "2026-02-01", market_value: 0, cash: 700, total: 700, net_deposits: 700 },
    ]);
  });

  it("counts a deposit made before the first trade and combines stocks + cash", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 60, currency: "EUR", fees: 0 });
    // Seed closes including today's date so fetchHistorical is a cache hit (no Yahoo).
    upsertDailyPrice({ symbol: "AAA", price_date: "2026-01-05", close: 70 });
    upsertDailyPrice({ symbol: "AAA", price_date: today, close: 70 });

    const out = await buildPortfolioHistory();

    // Output shape no longer carries invested/pnl.
    expect(Object.keys(out[0])).toEqual(["date", "market_value", "cash", "total", "net_deposits"]);

    // Day one is the pre-trade deposit: pure cash, no holdings yet.
    expect(out[0]).toEqual({
      date: "2026-01-02",
      market_value: 0,
      cash: 1000,
      total: 1000,
      net_deposits: 1000,
    });

    // Latest point: 10 shares @ 70 = 700 market value; cash = 1000 deposited − 600 invested.
    const last = out[out.length - 1];
    expect(last.market_value).toBeCloseTo(700, 6);
    expect(last.net_deposits).toBeCloseTo(1000, 6);
    expect(last.cash).toBeCloseTo(400, 6);
    expect(last.total).toBeCloseTo(1100, 6);
  });
});

// Issue #10: daily closes come from the market, so they are in the ticker's quote
// currency — not necessarily the currency the trades were booked in.
describe("buildPortfolioHistory — trade currency differs from quote currency", () => {
  it("values USD closes in USD even when the trade was booked in EUR", async () => {
    // AAPL quotes in USD; the user booked the buy in EUR.
    upsertTicker({ symbol: "AAPL", name: "Apple", currency: "USD", last_price: 200, last_price_at: new Date().toISOString() });
    insertTrade({ ticker: "AAPL", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    upsertDailyPrice({ symbol: "AAPL", price_date: "2026-01-05", close: 200 });
    upsertDailyPrice({ symbol: "AAPL", price_date: today, close: 200 });

    const out = await buildPortfolioHistory();
    const last = out[out.length - 1];
    // 10 × $200 = $2000 → EUR 1800, not the EUR 2000 the old code reported.
    expect(last.market_value).toBeCloseTo(1800, 6);
    // Cash still reflects what was actually paid: EUR 1000 out, no deposits.
    expect(last.cash).toBeCloseTo(-1000, 6);
  });

  it("keeps a matching-currency ticker unchanged", async () => {
    upsertTicker({ symbol: "BBB", name: "BBB", currency: "EUR", last_price: 70, last_price_at: new Date().toISOString() });
    insertTrade({ ticker: "BBB", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 60, currency: "EUR", fees: 0 });
    upsertDailyPrice({ symbol: "BBB", price_date: "2026-01-05", close: 70 });
    upsertDailyPrice({ symbol: "BBB", price_date: today, close: 70 });

    const out = await buildPortfolioHistory();
    expect(out[out.length - 1].market_value).toBeCloseTo(700, 6);
  });
});
