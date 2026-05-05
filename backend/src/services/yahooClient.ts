import YahooFinance from 'yahoo-finance2';

/**
 * Shared yahoo-finance2 v3 client.
 *
 * v3 requires instantiation: `new YahooFinance(opts)` instead of the v2 default singleton.
 * Re-using one instance across services keeps the cookie jar and queue shared, which
 * means one consent/cookie roundtrip on cold start instead of one per service.
 */
export const yahoo = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  // Yahoo aggressively rate-limits parallel requests (429 "Edge: Too Many Requests").
  // The built-in queue serializes calls; concurrency 2 + small spacing keeps us under the radar.
  queue: { concurrency: 2 },
});
