import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { getTicker, upsertTicker } from "../queries/prices";
import { fetchQuote as fetchQuoteCached } from "./marketData";
import type { PriceQuote } from "./providers/types";

/**
 * A provider can answer with a quote that carries no price at all (delisted symbol, halted
 * ticker, a fund that only quotes NAV). upsertTicker COALESCEs nulls, so writing such a
 * response used to keep the old price but stamp a fresh `last_price_at` — the cache then
 * looked fresh while the price was frozen, which is indistinguishable from a real update.
 */

const { fetchQuote } = vi.hoisted(() => ({
  fetchQuote: vi.fn<(symbol: string) => Promise<PriceQuote | null>>(),
}));
vi.mock("./providers", () => ({
  priceProvider: {
    name: "stub",
    fetchQuote,
    fetchHistorical: vi.fn(async () => []),
    search: vi.fn(async () => []),
  },
}));

const STALE_AT = "2026-06-01T10:00:00.000Z";

beforeEach(() => {
  db.exec(`DELETE FROM tickers;`);
  fetchQuote.mockReset();
});

describe("fetchQuote cache freshness", () => {
  it("stamps last_price_at when a real price comes back", async () => {
    upsertTicker({ symbol: "NVDA", currency: "USD", last_price: 100, last_price_at: STALE_AT });
    fetchQuote.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA",
      currency: "USD",
      last_price: 208.25,
      previous_close: null,
      exchange: "NasdaqGS",
      quote_type: "EQUITY",
    });

    const row = await fetchQuoteCached("NVDA");

    expect(row?.last_price).toBe(208.25);
    expect(row?.last_price_at).not.toBe(STALE_AT);
  });

  it("does not refresh last_price_at when the quote carries no price", async () => {
    upsertTicker({ symbol: "HFR", currency: "USD", last_price: 22.3, last_price_at: STALE_AT });
    fetchQuote.mockResolvedValue({
      symbol: "HFR",
      name: "Some Fund",
      currency: "USD",
      last_price: null,
      previous_close: null,
      exchange: null,
      quote_type: "MUTUALFUND",
    });

    await fetchQuoteCached("HFR");

    const row = getTicker("HFR");
    expect(row?.last_price).toBe(22.3);
    // The price is unchanged, so the timestamp must stay unchanged too: a stale price
    // must never be able to present itself as a fresh one.
    expect(row?.last_price_at).toBe(STALE_AT);
  });

  it("leaves the cached row untouched when the provider returns nothing", async () => {
    upsertTicker({ symbol: "AMD", currency: "USD", last_price: 484.74, last_price_at: STALE_AT });
    fetchQuote.mockResolvedValue(null);

    await fetchQuoteCached("AMD");

    const row = getTicker("AMD");
    expect(row?.last_price).toBe(484.74);
    expect(row?.last_price_at).toBe(STALE_AT);
  });

  it("still records name and currency for a brand-new symbol without a price", async () => {
    fetchQuote.mockResolvedValue({
      symbol: "NEW",
      name: "New Listing",
      currency: "EUR",
      last_price: null,
      previous_close: null,
      exchange: "Amsterdam",
      quote_type: "EQUITY",
    });

    await fetchQuoteCached("NEW");

    const row = getTicker("NEW");
    expect(row?.name).toBe("New Listing");
    expect(row?.currency).toBe("EUR");
    // No price yet → not fresh → the next call retries instead of trusting the cache.
    expect(row?.last_price_at).toBeNull();
  });
});

/**
 * The previous close is only interpretable next to the price it arrived with. Keeping an
 * older one when a fresh quote omits it would pair today's price with a days-old baseline
 * and report a day move that never happened.
 */
describe("previous close follows the price it came with", () => {
  it("clears a stale previous close when the new quote has a price but no baseline", async () => {
    upsertTicker({
      symbol: "NVDA",
      currency: "USD",
      last_price: 100,
      previous_close: 95,
      last_price_at: STALE_AT,
    });
    fetchQuote.mockResolvedValue({
      symbol: "NVDA",
      name: "NVIDIA",
      currency: "USD",
      last_price: 208.25,
      previous_close: null,
      exchange: "NasdaqGS",
      quote_type: "EQUITY",
    });

    await fetchQuoteCached("NVDA");
    expect(getTicker("NVDA")?.previous_close).toBeNull();
  });

  it("leaves it alone on an upsert that carries no price at all", () => {
    upsertTicker({
      symbol: "NVDA",
      currency: "USD",
      last_price: 100,
      previous_close: 95,
      last_price_at: STALE_AT,
    });
    upsertTicker({ symbol: "NVDA", name: "NVIDIA Corporation" });
    expect(getTicker("NVDA")?.previous_close).toBe(95);
  });
});
