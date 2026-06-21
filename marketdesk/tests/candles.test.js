// Tests for the fetchKlines module contract.
// Validates source tracking structure and SYMBOLS export.
// Network calls are not made — tests cover module interface and cache shape.
// Run with: node --test tests/candles.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYMBOLS } from '../cloudflare/src/binance.js';

test('SYMBOLS is a non-empty array of USDT pairs', () => {
  assert.ok(Array.isArray(SYMBOLS));
  assert.ok(SYMBOLS.length > 0);
  for (const sym of SYMBOLS) {
    assert.ok(typeof sym === 'string', `${sym} should be a string`);
    assert.ok(sym.endsWith('USDT'), `${sym} should end with USDT`);
  }
});

test('SYMBOLS includes the five expected assets', () => {
  const expected = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  for (const sym of expected) {
    assert.ok(SYMBOLS.includes(sym), `SYMBOLS should include ${sym}`);
  }
});

test('fetchKlines is exported as an async function', async () => {
  const mod = await import('../cloudflare/src/binance.js');
  assert.equal(typeof mod.fetchKlines, 'function');
  // Verify the function returns a promise (it's async)
  const result = mod.fetchKlines.constructor.name;
  assert.equal(result, 'AsyncFunction');
});

test('fetch24hTicker is exported as an async function', async () => {
  const mod = await import('../cloudflare/src/binance.js');
  assert.equal(typeof mod.fetch24hTicker, 'function');
  assert.equal(mod.fetch24hTicker.constructor.name, 'AsyncFunction');
});

test('/api/candles response shape: { candles, source } is documented in index.js', async () => {
  // Reads index.js to confirm the destructuring and response shape are present,
  // acting as a contract test that the backend exposes source.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dirname, '../cloudflare/src/index.js'), 'utf8');

  assert.ok(
    src.includes('const { candles, source } = await fetchKlines'),
    'index.js should destructure { candles, source } from fetchKlines'
  );
  assert.ok(
    src.includes('return json({ symbol, interval, candles, source })'),
    '/api/candles should return source field in JSON response'
  );
});
