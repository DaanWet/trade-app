import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { insertTrade } from "../queries/trades";
import { insertCashTx } from "../queries/cash";
import { upsertFxRate } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";
import { computeCashSummary } from "./cashService";

// All EUR amounts convert 1:1 (no provider call), so these assertions are deterministic.
// USD cases seed the fx_rates cache directly so convert() is a pure cache hit.

beforeEach(() => {
  db.exec(`DELETE FROM trades; DELETE FROM cash_transactions; DELETE FROM fx_rates;`);
  upsertSetting(SETTING_KEYS.DISPLAY_CURRENCY, "EUR");
});

describe("computeCashSummary", () => {
  it("is empty with no trades and no cash transactions", async () => {
    const s = await computeCashSummary();
    expect(s.cash_balance).toBe(0);
    expect(s.net_deposits).toBe(0);
    expect(s.invested).toBe(0);
    expect(s.display_currency).toBe("EUR");
  });

  it("counts a deposit as available cash", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    const s = await computeCashSummary();
    expect(s.net_deposits).toBe(1000);
    expect(s.cash_balance).toBe(1000);
  });

  it("nets withdrawals against deposits", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    insertCashTx({ type: "WITHDRAWAL", amount: 300, currency: "EUR", tx_date: "2026-02-01" });
    const s = await computeCashSummary();
    expect(s.net_deposits).toBe(700);
    expect(s.cash_balance).toBe(700);
  });

  it("a BUY lowers cash by shares*price + fees", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 60, currency: "EUR", fees: 5 });
    const s = await computeCashSummary();
    expect(s.invested).toBe(605); // 10*60 + 5
    expect(s.cash_balance).toBe(395); // 1000 - 605
  });

  it("a SELL raises cash by shares*price - fees", async () => {
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 60, currency: "EUR", fees: 0 });
    insertTrade({ ticker: "AAA", trade_date: "2026-03-01", side: "SELL", shares: 10, price: 70, currency: "EUR", fees: 0 });
    const s = await computeCashSummary();
    expect(s.invested).toBe(-100); // 600 buys - 700 sells
    expect(s.cash_balance).toBe(1100); // 1000 - (-100)
  });

  it("allows a negative balance (bought more than deposited)", async () => {
    insertTrade({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 60, currency: "EUR", fees: 0 });
    const s = await computeCashSummary();
    expect(s.cash_balance).toBe(-600);
  });

  it("converts foreign-currency amounts at the transaction date", async () => {
    // 1 USD = 0.9 EUR on these dates
    upsertFxRate({ base: "USD", quote: "EUR", rate_date: "2026-01-02", rate: 0.9 });
    upsertFxRate({ base: "USD", quote: "EUR", rate_date: "2026-01-05", rate: 0.9 });
    insertCashTx({ type: "DEPOSIT", amount: 1000, currency: "USD", tx_date: "2026-01-02" }); // 900 EUR
    insertTrade({ ticker: "BBB", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "USD", fees: 0 }); // 500 USD -> 450 EUR
    const s = await computeCashSummary();
    expect(s.net_deposits).toBeCloseTo(900, 6);
    expect(s.invested).toBeCloseTo(450, 6);
    expect(s.cash_balance).toBeCloseTo(450, 6);
  });
});
