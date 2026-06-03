export const SETTING_KEYS = {
  DISPLAY_CURRENCY: 'display_currency',
} as const;

export const TRADE_SIDES = ['BUY', 'SELL'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

export const CASH_TX_TYPES = ['DEPOSIT', 'WITHDRAWAL'] as const;
export type CashTxType = (typeof CASH_TX_TYPES)[number];

/**
 * Stale threshold for cached ticker prices (in seconds).
 * Below this age we serve from cache; above we re-fetch.
 */
export const PRICE_CACHE_TTL_SECONDS = 60 * 5; // 5 min

