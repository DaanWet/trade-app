import type { Database } from 'better-sqlite3';

/**
 * Schema migrations - idempotent, run on every startup.
 * To add a new migration: bump SCHEMA_VERSION and add a new block at the bottom.
 */

const SCHEMA_VERSION = 2;

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const current = (db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get() as { v: number | null }).v ?? 0;

  if (current < 1) {
    db.exec(`
      -- A trade is one buy/sell action by the user.
      -- Currency is the currency in which the trade was executed (price * shares).
      CREATE TABLE trades (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker        TEXT NOT NULL,
        trade_date    TEXT NOT NULL,                          -- ISO date YYYY-MM-DD
        side          TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        shares        REAL NOT NULL CHECK (shares > 0),
        price         REAL NOT NULL CHECK (price >= 0),       -- per-share price in trade currency
        currency      TEXT NOT NULL,                          -- ISO 4217 (USD, EUR, ...)
        fees          REAL NOT NULL DEFAULT 0,                -- fees in trade currency
        notes         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_trades_ticker ON trades(ticker);
      CREATE INDEX idx_trades_date ON trades(trade_date);

      -- Ticker metadata + last known price (cache).
      CREATE TABLE tickers (
        symbol         TEXT PRIMARY KEY,
        name           TEXT,
        currency       TEXT,                                  -- native price currency
        last_price     REAL,
        last_price_at  TEXT,                                  -- ISO datetime of last fetch
        exchange       TEXT,
        quote_type     TEXT
      );

      -- FX rate cache (date-keyed). rate = 1 base in quote currency.
      CREATE TABLE fx_rates (
        base       TEXT NOT NULL,
        quote      TEXT NOT NULL,
        rate_date  TEXT NOT NULL,
        rate       REAL NOT NULL,
        PRIMARY KEY (base, quote, rate_date)
      );

      -- Generic key-value settings store.
      CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT
      );

      INSERT INTO settings (key, value) VALUES
        ('display_currency', 'EUR');
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(1);
  }

  if (current < 2) {
    db.exec(`
      -- Daily close prices, immutable once recorded for a past date.
      -- Forward-filled across non-trading days (weekends/holidays) so every day in
      -- a covered range has a value, turning portfolio-history walks into pure cache hits.
      CREATE TABLE daily_prices (
        symbol      TEXT NOT NULL,
        price_date  TEXT NOT NULL,
        close       REAL NOT NULL,
        PRIMARY KEY (symbol, price_date)
      );
      CREATE INDEX idx_daily_prices_symbol ON daily_prices(symbol, price_date);
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(2);
  }

  console.log(`[schema] At version ${SCHEMA_VERSION}`);
}
