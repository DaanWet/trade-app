import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { insertTrade } from "../queries/trades";
import { upsertFxRate, upsertDailyPrice, upsertTicker } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";
import { computeTaxReport, listRealizedLotsForTax } from "./taxCalc";

// EUR amounts convert 1:1 (no provider call), so assertions are deterministic.
// The "fotomoment" close (31/12/2025) is seeded directly into daily_prices and a
// ticker row is seeded so priceAt() is a pure cache hit (no network).

const FOTO = "2025-12-31";

/** Seed the 31/12/2025 close for a ticker so priceAt() resolves without a provider call. */
function seedFotomoment(symbol: string, close: number, currency = "EUR") {
  upsertDailyPrice({ symbol, price_date: FOTO, close });
  upsertTicker({ symbol, currency });
}

async function lotFor(ticker: string) {
  const lots = await listRealizedLotsForTax();
  const found = lots.find((l) => l.ticker === ticker.toUpperCase());
  if (!found) throw new Error(`no realized lot for ${ticker}`);
  return found;
}

async function year(y: number) {
  const report = await computeTaxReport();
  return report.find((r) => r.year === y);
}

beforeEach(() => {
  db.exec(
    `DELETE FROM trades; DELETE FROM cash_transactions; DELETE FROM fx_rates; DELETE FROM daily_prices; DELETE FROM tickers;`,
  );
  upsertSetting(SETTING_KEYS.DISPLAY_CURRENCY, "EUR");
});

describe("taxCalc — per-lot taxable gain (fotomoment rules)", () => {
  it("bought and sold in 2026+ uses purchase price: taxable = S - P", async () => {
    insertTrade({ ticker: "AAA", trade_date: "2026-02-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "AAA", trade_date: "2026-06-01", side: "SELL", shares: 10, price: 120, currency: "EUR", fees: 0 });

    const lot = await lotFor("AAA");
    expect(lot.taxable_pnl_display).toBeCloseTo(200, 6); // 1200 - 1000
    expect(lot.basis_used).toBe("purchase");
    expect(lot.fotomoment_value_display).toBeNull();
  });

  it("pre-2026 buy, F > P: taxable steps up to the fotomoment basis (gain)", async () => {
    seedFotomoment("BBB", 150); // F = 150 * 10 = 1500
    insertTrade({ ticker: "BBB", trade_date: "2024-03-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 }); // P = 1000
    insertTrade({ ticker: "BBB", trade_date: "2026-06-01", side: "SELL", shares: 10, price: 200, currency: "EUR", fees: 0 }); // S = 2000

    const lot = await lotFor("BBB");
    expect(lot.fotomoment_value_display).toBeCloseTo(1500, 6);
    expect(lot.taxable_pnl_display).toBeCloseTo(500, 6); // 2000 - 1500
    expect(lot.realized_pnl_display).toBeCloseTo(1000, 6); // economic 2000 - 1000
    expect(lot.basis_used).toBe("fotomoment");
  });

  it("pre-2026 buy, F > P, sold below fotomoment: deductible loss = S - F", async () => {
    seedFotomoment("CCC", 150); // F = 1500
    insertTrade({ ticker: "CCC", trade_date: "2024-03-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 }); // P = 1000
    insertTrade({ ticker: "CCC", trade_date: "2026-06-01", side: "SELL", shares: 10, price: 130, currency: "EUR", fees: 0 }); // S = 1300

    const lot = await lotFor("CCC");
    expect(lot.taxable_pnl_display).toBeCloseTo(-200, 6); // 1300 - 1500
    expect(lot.basis_used).toBe("fotomoment");
  });

  it("pre-2026 buy, F < P, sold above purchase: taxable = S - P", async () => {
    seedFotomoment("DDD", 80); // F = 800
    insertTrade({ ticker: "DDD", trade_date: "2024-03-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 }); // P = 1000
    insertTrade({ ticker: "DDD", trade_date: "2026-06-01", side: "SELL", shares: 10, price: 110, currency: "EUR", fees: 0 }); // S = 1100

    const lot = await lotFor("DDD");
    expect(lot.taxable_pnl_display).toBeCloseTo(100, 6); // 1100 - 1000
    expect(lot.basis_used).toBe("purchase");
  });

  it("pre-2026 buy, F < P, sold between F and P: shielded to 0 (scenario 2)", async () => {
    seedFotomoment("EEE", 120); // F = 120
    insertTrade({ ticker: "EEE", trade_date: "2024-03-01", side: "BUY", shares: 1, price: 150, currency: "EUR", fees: 0 }); // P = 150
    insertTrade({ ticker: "EEE", trade_date: "2026-06-01", side: "SELL", shares: 1, price: 135, currency: "EUR", fees: 0 }); // S = 135

    const lot = await lotFor("EEE");
    expect(lot.taxable_pnl_display).toBeCloseTo(0, 6);
    expect(lot.basis_used).toBe("shielded");
  });

  it("pre-2026 buy, F < P, sold below F: deductible loss = S - F (scenario 1)", async () => {
    seedFotomoment("FFF", 80); // F = 80
    insertTrade({ ticker: "FFF", trade_date: "2024-03-01", side: "BUY", shares: 1, price: 100, currency: "EUR", fees: 0 }); // P = 100
    insertTrade({ ticker: "FFF", trade_date: "2026-06-01", side: "SELL", shares: 1, price: 60, currency: "EUR", fees: 0 }); // S = 60

    const lot = await lotFor("FFF");
    expect(lot.taxable_pnl_display).toBeCloseTo(-20, 6); // 60 - 80
    expect(lot.basis_used).toBe("fotomoment");
  });

  it("sold before 2026: not taxable, reports economic P&L only", async () => {
    seedFotomoment("GGG", 200); // even if seeded, ignored for pre-2026 sells
    insertTrade({ ticker: "GGG", trade_date: "2024-03-01", side: "BUY", shares: 10, price: 100, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "GGG", trade_date: "2025-06-01", side: "SELL", shares: 10, price: 130, currency: "EUR", fees: 0 });

    const lot = await lotFor("GGG");
    expect(lot.taxable_pnl_display).toBeCloseTo(300, 6); // economic 1300 - 1000
    expect(lot.basis_used).toBe("none");
    expect(lot.taxable).toBe(false);

    const y2025 = await year(2025);
    expect(y2025?.applies).toBe(false);
    expect(y2025?.tax_due).toBe(0);
  });
});

describe("taxCalc — yearly aggregation (loss netting + exemption + rate)", () => {
  it("nets same-year losses against gains before the exemption", async () => {
    // Gain lot: +15000
    insertTrade({ ticker: "GAIN", trade_date: "2026-01-01", side: "BUY", shares: 1, price: 10000, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "GAIN", trade_date: "2026-06-01", side: "SELL", shares: 1, price: 25000, currency: "EUR", fees: 0 });
    // Loss lot: -3000
    insertTrade({ ticker: "LOSS", trade_date: "2026-01-01", side: "BUY", shares: 1, price: 5000, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "LOSS", trade_date: "2026-06-01", side: "SELL", shares: 1, price: 2000, currency: "EUR", fees: 0 });

    const y = await year(2026);
    expect(y?.gains).toBeCloseTo(15000, 6);
    expect(y?.losses).toBeCloseTo(3000, 6);
    expect(y?.net_gain_pretax).toBeCloseTo(12000, 6); // 15000 - 3000
    expect(y?.taxable_amount).toBeCloseTo(2000, 6); // max(0, 12000 - 10000)
    expect(y?.tax_due).toBeCloseTo(200, 6); // 2000 * 10%
    expect(y?.applies).toBe(true);
  });

  it("no tax when net gain after losses stays under the exemption", async () => {
    insertTrade({ ticker: "G", trade_date: "2026-01-01", side: "BUY", shares: 1, price: 1000, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "G", trade_date: "2026-06-01", side: "SELL", shares: 1, price: 9000, currency: "EUR", fees: 0 }); // +8000
    insertTrade({ ticker: "L", trade_date: "2026-01-01", side: "BUY", shares: 1, price: 2000, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "L", trade_date: "2026-06-01", side: "SELL", shares: 1, price: 1000, currency: "EUR", fees: 0 }); // -1000

    const y = await year(2026);
    expect(y?.net_gain_pretax).toBeCloseTo(7000, 6); // 8000 - 1000
    expect(y?.taxable_amount).toBe(0);
    expect(y?.tax_due).toBe(0);
  });
});

describe("taxCalc — currency conversion", () => {
  it("converts a USD lot at the sell-date rate", async () => {
    upsertFxRate({ base: "USD", quote: "EUR", rate_date: "2026-03-01", rate: 0.9 });
    insertTrade({ ticker: "USX", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "USD", fees: 0 }); // 500 USD
    insertTrade({ ticker: "USX", trade_date: "2026-03-01", side: "SELL", shares: 10, price: 70, currency: "USD", fees: 0 }); // 700 USD

    const lot = await lotFor("USX");
    expect(lot.cost_basis_display).toBeCloseTo(450, 6); // 500 * 0.9
    expect(lot.proceeds_display).toBeCloseTo(630, 6); // 700 * 0.9
    expect(lot.taxable_pnl_display).toBeCloseTo(180, 6); // 200 * 0.9
  });
});
