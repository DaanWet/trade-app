import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { db } from "../db";
import { upsertTicker } from "../queries/prices";
import { upsertSetting } from "../helpers/settings";
import { SETTING_KEYS } from "../helpers/constants";

// In-memory DB (vitest sets DB_PATH=:memory:). A fresh `tickers` row makes the POST's
// fire-and-forget quote warm-up a cache hit (no network). EUR ⇒ FX converts 1:1.
function seedFreshQuote(symbol: string, last_price = 100, currency = "EUR") {
  upsertTicker({ symbol, name: symbol, currency, last_price, last_price_at: new Date().toISOString() });
}

beforeEach(() => {
  db.exec(
    `DELETE FROM trades; DELETE FROM fx_rates; DELETE FROM daily_prices; DELETE FROM tickers; DELETE FROM cash_transactions;`,
  );
  upsertSetting(SETTING_KEYS.DISPLAY_CURRENCY, "EUR");
  seedFreshQuote("AAPL");
});

// BUYs lower cash → confirm=1 bypasses the (separate) cash-overdraw guard so we isolate
// the share check. SELLs raise cash, so they never need it.
const buy = (shares: number, trade_date = "2026-01-01") =>
  request(app)
    .post("/api/trades?confirm=1")
    .send({ ticker: "AAPL", trade_date, side: "BUY", shares, price: 100, currency: "EUR", fees: 0 });

const sell = (shares: number, trade_date = "2026-02-01") =>
  request(app)
    .post("/api/trades")
    .send({ ticker: "AAPL", trade_date, side: "SELL", shares, price: 120, currency: "EUR", fees: 0 });

describe("POST /api/trades — share overdraw guard", () => {
  it("allows a SELL within the shares held", async () => {
    await buy(10);
    const res = await sell(10);
    expect(res.status).toBe(201);
  });

  it("blocks a SELL that exceeds the shares held", async () => {
    await buy(10);
    const res = await sell(11);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_SHARES");
    expect(res.body.shares_held).toBe(10);
  });

  it("cannot be bypassed with ?confirm=1 (hard block)", async () => {
    await buy(10);
    const res = await request(app)
      .post("/api/trades?confirm=1")
      .send({ ticker: "AAPL", trade_date: "2026-02-01", side: "SELL", shares: 11, price: 120, currency: "EUR", fees: 0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_SHARES");
  });

  it("blocks a back-dated SELL placed before the covering BUY", async () => {
    await buy(10, "2026-02-01");
    const res = await sell(5, "2026-01-01"); // before the buy
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_SHARES");
  });
});

describe("PUT /api/trades/:id — share overdraw guard", () => {
  it("blocks shrinking a BUY so a later SELL no longer fits", async () => {
    const buyRes = await buy(10);
    await sell(8);
    const res = await request(app)
      .put(`/api/trades/${buyRes.body.id}`)
      .send({ ticker: "AAPL", trade_date: "2026-01-01", side: "BUY", shares: 5, price: 100, currency: "EUR", fees: 0 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_SHARES");
  });
});

describe("DELETE /api/trades/:id — share overdraw guard", () => {
  it("blocks deleting a BUY that leaves a later SELL uncovered", async () => {
    const buyRes = await buy(10);
    await sell(10);
    const res = await request(app).delete(`/api/trades/${buyRes.body.id}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INSUFFICIENT_SHARES");
  });

  it("allows deleting a SELL (raises holdings, never a short)", async () => {
    await buy(10);
    const sellRes = await sell(4);
    // confirm=1 waives the (separate) cash soft-confirm; the hard share block ignores
    // it, so a 204 proves the share guard did not fire on a SELL deletion.
    const res = await request(app).delete(`/api/trades/${sellRes.body.id}?confirm=1`);
    expect(res.status).toBe(204);
  });
});

describe("GET /api/positions/holdings", () => {
  it("returns open shares for a ticker", async () => {
    await buy(10);
    await sell(4);
    const res = await request(app).get("/api/positions/holdings?ticker=AAPL");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticker: "AAPL", shares_held: 6 });
  });

  it("honours the date cap and excludeTradeId", async () => {
    await buy(10, "2026-01-01");
    const sellRes = await sell(4, "2026-02-01");
    const before = await request(app).get("/api/positions/holdings?ticker=AAPL&date=2026-01-15");
    expect(before.body.shares_held).toBe(10); // before the SELL
    const excl = await request(app).get(`/api/positions/holdings?ticker=AAPL&excludeTradeId=${sellRes.body.id}`);
    expect(excl.body.shares_held).toBe(10); // SELL ignored
  });

  it("400s when ticker is missing", async () => {
    const res = await request(app).get("/api/positions/holdings");
    expect(res.status).toBe(400);
  });
});
