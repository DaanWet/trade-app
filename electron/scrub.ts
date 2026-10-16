/**
 * Pure scrub helpers for the Sentry hooks in sentry.ts. Kept free of any Sentry/Electron
 * import so they can be exercised from a plain Node script (electron/ has no test runner).
 */

/** Redact financial/PII tokens from free text before it leaves the machine. */
export function scrubText(input: string): string {
  return input
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>') // unix absolute paths
    .replace(/[A-Za-z]:\\[\\\w.@ -]+/g, '<path>') // windows absolute paths
    .replace(/\b(?:EUR|USD|GBP|CHF|JPY|CAD|AUD)\s?-?\d[\d.,]*/gi, '<amount>') // currency amounts
    .replace(/\b\d+[.,]\d+\b/g, '<num>') // decimals (prices, share counts)
    .replace(/\b[A-Z]{1,6}(?:\.[A-Z])?\b/g, '<ticker>'); // ticker-like tokens
}

/** Drop everything after `?` — query strings carry tickers (`?q=`, `?symbols=`) and keywords. */
export function stripQuery(value: string): string {
  const i = value.indexOf('?');
  return i === -1 ? value : `${value.slice(0, i)}?<redacted>`;
}

/** Span data keys whose string values are a URL/SQL that may carry a query: cut at the `?`. */
export const SENSITIVE_SPAN_DATA = [
  'http.url',
  'http.target',
  'url.full',
  'url.path',
  'db.statement',
  'db.query.text',
];

/**
 * Data keys whose value IS a query string or fragment (`?q=ECB rente&hl=nl`). stripQuery
 * would keep it when it has no leading `?`, so these are deleted outright.
 */
export const QUERY_VALUE_KEYS = ['http.query', 'http.fragment', 'url.query', 'url.fragment'];

/** Breadcrumb data keys that hold a URL (fetch/http breadcrumbs): the query part is cut. */
const BREADCRUMB_URL_KEYS = ['url', 'http.url', 'url.full'];

/**
 * Scrub the span data of a transaction/span in place: URL-like values lose their query, and
 * query-valued keys are removed.
 */
export function scrubSpanData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of SENSITIVE_SPAN_DATA) {
    if (typeof data[key] === 'string') data[key] = stripQuery(data[key] as string);
  }
  for (const key of QUERY_VALUE_KEYS) delete data[key];
}

/**
 * Scrub one breadcrumb in place. Message text is redacted via scrubText; the `data` bag is
 * where the leaks were: Node's fetch integration records `http.query` (`?q=<keyword>…`) and
 * the full url, and console breadcrumbs keep the raw log arguments in `arguments`.
 */
export function scrubBreadcrumb(b: { message?: unknown; data?: Record<string, unknown> }): void {
  if (typeof b.message === 'string') b.message = scrubText(b.message);
  const data = b.data;
  if (!data) return;
  for (const key of QUERY_VALUE_KEYS) delete data[key];
  delete data.arguments;
  for (const key of BREADCRUMB_URL_KEYS) {
    if (typeof data[key] === 'string') data[key] = stripQuery(data[key] as string);
  }
}

/** Strip request bodies/query/cookies, cut the query off the URL and redact its path (shared by error + transaction). */
export function scrubRequest(
  req: { data?: unknown; query_string?: unknown; cookies?: unknown; url?: unknown } | undefined,
): void {
  if (!req) return;
  delete req.data;
  delete req.query_string;
  delete req.cookies;
  if (typeof req.url === 'string') req.url = scrubText(stripQuery(req.url));
}
