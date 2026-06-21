// Unit tests for the range-prediction engine.
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictRange } from '../_archive/oracle/predictions.js';

function makeCandle(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

function trendingCandles(start, step, count, volume = 100) {
  const out = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    const next = price + step;
    const high = Math.max(price, next) + 5;
    const low = Math.min(price, next) - 5;
    out.push(makeCandle(i, price, high, low, next, volume));
    price = next;
  }
  return out;
}

test('predictRange returns a well-formed object for 15min and 1h', () => {
  const candles = trendingCandles(60000, 5, 60);
  for (const interval of ['15min', '1h']) {
    const p = predictRange(candles, interval);
    assert.equal(p.interval, interval);
    assert.ok(p.range_low < p.range_high, 'range_low must be below range_high');
    assert.ok(p.midpoint >= p.range_low && p.midpoint <= p.range_high);
    assert.ok(['bullish', 'bearish', 'neutral'].includes(p.bias));
    assert.ok(p.confidence >= 20 && p.confidence <= 95);
    assert.equal(typeof p.explanation, 'string');
    assert.ok(p.explanation.includes('educacional'));
  }
});

test('15min range is narrower than the 1h range for the same data (lower volatility multiplier)', () => {
  const candles = trendingCandles(60000, 5, 60);
  const p15 = predictRange(candles, '15min');
  const p1h = predictRange(candles, '1h');
  const width15 = p15.range_high - p15.range_low;
  const width1h = p1h.range_high - p1h.range_low;
  assert.ok(width15 < width1h, `expected 15min width (${width15}) < 1h width (${width1h})`);
});

test('a sustained uptrend produces a bullish (or at worst neutral) bias, never bearish', () => {
  const candles = trendingCandles(60000, 8, 60);
  const p = predictRange(candles, '15min');
  assert.notEqual(p.bias, 'bearish');
});

test('a sustained downtrend produces a bearish (or at worst neutral) bias, never bullish', () => {
  const candles = trendingCandles(60000, -8, 60);
  const p = predictRange(candles, '15min');
  assert.notEqual(p.bias, 'bullish');
});

test('example output for BTC-like synthetic data is internally consistent', () => {
  // Simulates a mildly bullish BTC session around $64,000.
  const candles = trendingCandles(63800, 6, 80, 120);
  const fifteenMin = predictRange(candles, '15min');
  const oneHour = predictRange(candles, '1h');

  // eslint-disable-next-line no-console
  console.log('Exemplo BTC 15min:', JSON.stringify(fifteenMin, null, 2));
  // eslint-disable-next-line no-console
  console.log('Exemplo BTC 1h:', JSON.stringify(oneHour, null, 2));

  assert.ok(fifteenMin.range_low > 0);
  assert.ok(oneHour.range_low > 0);
});
