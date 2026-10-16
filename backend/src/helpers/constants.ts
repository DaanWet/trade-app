export const SETTING_KEYS = {
  DISPLAY_CURRENCY: 'display_currency',
  /** ISO timestamp of the news tab's last visit; articles fetched after it count as new. */
  NEWS_LAST_SEEN: 'news_last_seen',
} as const;

export const TRADE_SIDES = ['BUY', 'SELL'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

/** A position counts as open above this many shares (ignores floating-point dust). */
export const OPEN_SHARES_EPSILON = 1e-9;

export const CASH_TX_TYPES = ['DEPOSIT', 'WITHDRAWAL'] as const;
export type CashTxType = (typeof CASH_TX_TYPES)[number];

/**
 * Stale threshold for cached ticker prices (in seconds).
 * Below this age we serve from cache; above we re-fetch.
 */
export const PRICE_CACHE_TTL_SECONDS = 60 * 5; // 5 min

export const NEWS_TOPIC_KINDS = ['TICKER', 'KEYWORD'] as const;
export type NewsTopicKind = (typeof NEWS_TOPIC_KINDS)[number];

/** Background news refresh cadence; the navbar badge poll is what triggers it. */
export const NEWS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
/** Sooner retry when the last round failed for every topic (e.g. the app started offline). */
export const NEWS_RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
/** Articles older than this are skipped at ingest and pruned after every round. */
export const NEWS_RETENTION_DAYS = 30;

