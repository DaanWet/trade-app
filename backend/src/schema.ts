import type { Database } from 'better-sqlite3';
import { logger } from './helpers/logger';

/**
 * Schema migrations - idempotent, run on every startup.
 * To add a new migration: bump SCHEMA_VERSION and add a new block at the bottom.
 */

const SCHEMA_VERSION = 6;

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

  if (current < 3) {
    db.exec(`
      -- Cash deposits/withdrawals into the portfolio. The current cash balance is
      -- derived: net deposits − net invested in stocks (see services/cashService.ts).
      -- amount is always positive; the type determines the sign.
      CREATE TABLE cash_transactions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        type       TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
        amount     REAL NOT NULL CHECK (amount > 0),
        currency   TEXT NOT NULL,                          -- ISO 4217
        tx_date    TEXT NOT NULL,                          -- ISO date YYYY-MM-DD
        notes      TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_cash_tx_date ON cash_transactions(tx_date);
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(3);
  }

  if (current < 4) {
    db.exec(`
      -- Previous session's close, as reported alongside the live quote. Drives the
      -- dashboard's day P&L. Nullable: not every quote carries one, and a missing value
      -- must read as "unknown" rather than as a zero move.
      ALTER TABLE tickers ADD COLUMN previous_close REAL;
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(4);
  }

  if (current < 5) {
    db.exec(`
      -- News tab (issue #11). Only what the user follows explicitly (watchlist tickers +
      -- keywords); open positions are derived from trades and never stored here.
      -- NOCASE: "ECB rente" and "ecb rente" are the same keyword.
      CREATE TABLE news_topics (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT NOT NULL CHECK (kind IN ('TICKER', 'KEYWORD')),
        value      TEXT NOT NULL COLLATE NOCASE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (kind, value)
      );

      CREATE TABLE news_articles (
        id           TEXT PRIMARY KEY,                     -- Yahoo uuid / Google guid
        title        TEXT NOT NULL,
        publisher    TEXT,
        url          TEXT NOT NULL,
        published_at TEXT NOT NULL,                        -- ISO 8601 UTC
        source       TEXT NOT NULL CHECK (source IN ('yahoo', 'google')),
        fetched_at   TEXT NOT NULL                         -- first sighting; never updated
      );
      CREATE INDEX idx_news_articles_published ON news_articles(published_at);

      -- An article's badges. Composite PK, no surrogate id: nothing references a single
      -- link, and the PK is what makes INSERT OR IGNORE idempotent across the symbol/name
      -- queries and every refresh. kind+value rather than an FK to news_topics, because
      -- position topics have no row there.
      CREATE TABLE news_article_topics (
        article_id TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        value      TEXT NOT NULL,
        PRIMARY KEY (article_id, kind, value)
      );
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(5);
  }

  if (current < 6) {
    db.exec(`
      -- Article previews (issue #11 addendum): a thumbnail and the publisher's own intro
      -- (og:description), read once per article by the enrichment step. preview_at NULL =
      -- still to try; a transient failure leaves it NULL so the next round retries.
      ALTER TABLE news_articles ADD COLUMN image_url  TEXT;
      ALTER TABLE news_articles ADD COLUMN summary    TEXT;
      ALTER TABLE news_articles ADD COLUMN preview_at TEXT;
    `);
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(6);
  }

  logger.info('schema', `At version ${SCHEMA_VERSION}`);
}
