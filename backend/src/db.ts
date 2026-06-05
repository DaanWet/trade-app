import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './schema';
import { logger } from './helpers/logger';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'trades.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

runMigrations(db);

logger.info('db', `Connected to ${DB_PATH}`);
