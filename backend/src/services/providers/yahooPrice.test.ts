import { beforeEach, describe, expect, it, vi } from "vitest";
import { yahooPriceProvider } from "./yahooPrice";

/**
 * Regression tests for the Yahoo crumb outage (see `chartQuote.ts`).
 *
 * Yahoo's /v7/finance/quote endpoint needs a crumb, which yahoo-finance2 can only get by
 * walking the EU consent flow. When that flow bounces (`Unexpected redirect to
 * https://finance.yahoo.com/quote/AAPL?guccounter=1`) every quote fails indefinitely while
 * /v8/finance/chart — which needs no crumb — keeps working. fetchQuote must survive that.
 */

const { quote, chart, search } = vi.hoisted(() => ({
  quote: vi.fn(),
  chart: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../yahooClient", () => ({ yahoo: { quote, chart, search } }));

const CRUMB_ERROR = new Error(
  "Unexpected redirect to https://finance.yahoo.com/quote/AAPL?guccounter=1",
);

const CHART_RESULT = {
  meta: {
    currency: "USD",
    instrumentType: "EQUITY",
    fullExchangeName: "NasdaqGS",
    regularMarketPrice: 206.64,
    longName: "NVIDIA Corporation",
    shortName: "NVIDIA",
  },
  // Two daily candles: the last one is the session in progress, so its predecessor is
  // the previous close.
  quotes: [{ close: 205.12 }, { close: 206.5 }],
};

describe("yahooPriceProvider.fetchQuote", () => {
  beforeEach(() => {
    quote.mockReset();
    chart.mockReset();
  });

  it("uses quote() and never touches chart() when the crumb flow works", async () => {
    quote.mockResolvedValue({
      regularMarketPrice: 208.25,
      regularMarketPreviousClose: 204.10,
      currency: "USD",
      longName: "NVIDIA Corporation",
      fullExchangeName: "NasdaqGS",
      quoteType: "EQUITY",
    });

    await expect(yahooPriceProvider.fetchQuote("nvda")).resolves.toEqual({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      currency: "USD",
      last_price: 208.25,
      previous_close: 204.10,
      exchange: "NasdaqGS",
      quote_type: "EQUITY",
    });
    expect(chart).not.toHaveBeenCalled();
  });

  it("falls back to chart() metadata when quote() throws the crumb/consent error", async () => {
    quote.mockRejectedValue(CRUMB_ERROR);
    chart.mockResolvedValue(CHART_RESULT);

    await expect(yahooPriceProvider.fetchQuote("nvda")).resolves.toEqual({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      currency: "USD",
      last_price: 206.64,
      previous_close: 205.12,
      exchange: "NasdaqGS",
      quote_type: "EQUITY",
    });
    expect(chart).toHaveBeenCalledOnce();
  });

  it("falls back to chart() when quote() resolves without a price", async () => {
    quote.mockResolvedValue({ currency: "USD", regularMarketPrice: undefined });
    chart.mockResolvedValue(CHART_RESULT);

    const result = await yahooPriceProvider.fetchQuote("NVDA");
    expect(result?.last_price).toBe(206.64);
  });

  it("returns null when both endpoints fail, rather than throwing", async () => {
    quote.mockRejectedValue(CRUMB_ERROR);
    chart.mockRejectedValue(new Error("fetch failed"));

    await expect(yahooPriceProvider.fetchQuote("NVDA")).resolves.toBeNull();
  });
});

describe("yahooPriceProvider.fetchQuote — previous close", () => {
  beforeEach(() => {
    quote.mockReset();
    chart.mockReset();
    quote.mockRejectedValue(CRUMB_ERROR); // force the chart path
  });

  it("takes the candle before the last one, not the last close itself", async () => {
    chart.mockResolvedValue({
      meta: { currency: "USD", regularMarketPrice: 210 },
      quotes: [{ close: 190 }, { close: 200 }, { close: 209.5 }],
    });

    const result = await yahooPriceProvider.fetchQuote("NVDA");
    expect(result?.last_price).toBe(210);
    expect(result?.previous_close).toBe(200);
  });

  it("ignores chartPreviousClose, which sits before the whole requested range", async () => {
    chart.mockResolvedValue({
      meta: { currency: "USD", regularMarketPrice: 210, previousClose: 205, chartPreviousClose: 150 },
      quotes: [{ close: 209.5 }],
    });

    const result = await yahooPriceProvider.fetchQuote("NVDA");
    expect(result?.previous_close).toBe(205);
  });

  it("reports an unknown previous close as null instead of guessing", async () => {
    chart.mockResolvedValue({ meta: { currency: "USD", regularMarketPrice: 210 }, quotes: [] });

    const result = await yahooPriceProvider.fetchQuote("NVDA");
    expect(result?.last_price).toBe(210);
    expect(result?.previous_close).toBeNull();
  });
});
