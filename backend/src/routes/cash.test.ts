import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { db } from "../db";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";

beforeEach(() => {
  db.exec(`DELETE FROM trades; DELETE FROM cash_transactions; DELETE FROM fx_rates;`);
  upsertSetting(SETTING_KEYS.DISPLAY_CURRENCY, "EUR");
});

describe("cash routes", () => {
  it("starts empty", async () => {
    const res = await request(app).get("/api/cash");
    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
    expect(res.body.summary.cash_balance).toBe(0);
  });

  it("creates a deposit and reflects it in the summary", async () => {
    const create = await request(app)
      .post("/api/cash")
      .send({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeGreaterThan(0);

    const list = await request(app).get("/api/cash");
    expect(list.body.transactions).toHaveLength(1);
    expect(list.body.summary.cash_balance).toBe(1000);
  });

  it("rejects an invalid amount with 400", async () => {
    const res = await request(app)
      .post("/api/cash")
      .send({ type: "DEPOSIT", amount: 0, currency: "EUR", tx_date: "2026-01-02" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown type with 400", async () => {
    const res = await request(app)
      .post("/api/cash")
      .send({ type: "TRANSFER", amount: 10, currency: "EUR", tx_date: "2026-01-02" });
    expect(res.status).toBe(400);
  });

  it("updates and deletes a transaction", async () => {
    const created = await request(app)
      .post("/api/cash")
      .send({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    const id = created.body.id;

    const updated = await request(app)
      .put(`/api/cash/${id}`)
      .send({ type: "DEPOSIT", amount: 2500, currency: "EUR", tx_date: "2026-01-02" });
    expect(updated.status).toBe(200);
    expect(updated.body.amount).toBe(2500);

    const del = await request(app).delete(`/api/cash/${id}`);
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/cash");
    expect(list.body.transactions).toHaveLength(0);
  });

  it("returns 404 for a missing transaction", async () => {
    expect((await request(app).put("/api/cash/9999").send({ type: "DEPOSIT", amount: 1, currency: "EUR", tx_date: "2026-01-02" })).status).toBe(404);
    expect((await request(app).delete("/api/cash/9999")).status).toBe(404);
  });

  it("warns with 409 CASH_OVERDRAW when a BUY exceeds available cash, and proceeds on confirm", async () => {
    await request(app)
      .post("/api/cash")
      .send({ type: "DEPOSIT", amount: 100, currency: "EUR", tx_date: "2026-01-02" });

    // BUY costing 500 EUR against a 100 EUR balance → overdraw.
    const blocked = await request(app)
      .post("/api/trades")
      .send({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("CASH_OVERDRAW");

    // Same trade with confirm: true goes through.
    const confirmed = await request(app)
      .post("/api/trades")
      .send({ ticker: "AAA", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", confirm: true });
    expect(confirmed.status).toBe(201);
  });

  it("does not warn on a SELL (it raises cash), even with a negative balance", async () => {
    // Buy 10 @ 50 with no deposits → cash already negative.
    await request(app)
      .post("/api/trades")
      .send({ ticker: "BBB", trade_date: "2026-01-05", side: "BUY", shares: 10, price: 50, currency: "EUR", confirm: true });
    const sell = await request(app)
      .post("/api/trades")
      .send({ ticker: "BBB", trade_date: "2026-02-05", side: "SELL", shares: 5, price: 60, currency: "EUR" });
    expect(sell.status).toBe(201);
  });

  it("folds cash into /api/positions totals (cash_pct + invested_pct = 100)", async () => {
    // No live quotes in test → market_value is 0, so net worth is just the cash.
    await request(app)
      .post("/api/cash")
      .send({ type: "DEPOSIT", amount: 1000, currency: "EUR", tx_date: "2026-01-02" });
    const res = await request(app).get("/api/positions");
    expect(res.status).toBe(200);
    expect(res.body.totals.cash_balance).toBe(1000);
    expect(res.body.totals.net_worth).toBe(1000);
    expect(res.body.totals.cash_pct).toBe(100);
  });
});
