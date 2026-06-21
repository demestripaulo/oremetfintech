import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'marketdesk.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    interval TEXT NOT NULL,
    range_low REAL NOT NULL,
    range_high REAL NOT NULL,
    midpoint REAL NOT NULL,
    bias TEXT NOT NULL,
    confidence REAL NOT NULL,
    explanation TEXT NOT NULL,
    price_at_generation REAL,
    resolved_price REAL,
    resolved_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_predictions_symbol_time
    ON predictions (symbol, generated_at);
`);

export function insertPrediction(p) {
  const stmt = db.prepare(`
    INSERT INTO predictions
      (symbol, generated_at, interval, range_low, range_high, midpoint, bias, confidence, explanation, price_at_generation)
    VALUES (@symbol, @generated_at, @interval, @range_low, @range_high, @midpoint, @bias, @confidence, @explanation, @price_at_generation)
  `);
  return stmt.run(p).lastInsertRowid;
}

export function latestPredictions(symbol, limit = 24) {
  const stmt = db.prepare(`
    SELECT * FROM predictions
    WHERE symbol = ?
    ORDER BY generated_at DESC
    LIMIT ?
  `);
  return stmt.all(symbol, limit);
}

export function resolveDuePredictions(symbol, currentPrice, now = Date.now()) {
  const stmt = db.prepare(`
    SELECT * FROM predictions
    WHERE symbol = ? AND resolved_at IS NULL
  `);
  const pending = stmt.all(symbol);
  const update = db.prepare(`
    UPDATE predictions SET resolved_price = ?, resolved_at = ? WHERE id = ?
  `);
  for (const row of pending) {
    const horizonMs = row.interval === '15min' ? 15 * 60 * 1000 : 60 * 60 * 1000;
    if (now - row.generated_at >= horizonMs) {
      update.run(currentPrice, now, row.id);
    }
  }
}

export default db;
