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
  quotes: [],
};

describe("yahooPriceProvider.fetchQuote", () => {
  beforeEach(() => {
    quote.mockReset();
    chart.mockReset();
  });

  it("uses quote() and never touches chart() when the crumb flow works", async () => {
    quote.mockResolvedValue({
      regularMarketPrice: 208.25,
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
