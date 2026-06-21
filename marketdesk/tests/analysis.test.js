// Unit tests for the technical analysis module (RSI, MACD, ATR, Bollinger Bands).
// Run with: node --test tests/
// Uses Node's built-in test runner — no extra dependencies required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollinger,
  volumeRatio,
  detectCandlePattern,
  calculatePivotPoints,
  sma,
  ema,
  round,
} from '../_archive/oracle/analysis.js';

function makeCandle(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

function flatCandles(price, count, volume = 100) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(makeCandle(i, price, price, price, price, volume));
  }
  return out;
}

function trendingCandles(start, step, count, volume = 100) {
  const out = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    const next = price + step;
    const high = Math.max(price, next);
    const low = Math.min(price, next);
    out.push(makeCandle(i, price, high, low, next, volume));
    price = next;
  }
  return out;
}

// ---------- RSI ----------
test('RSI returns 100 when prices rise monotonically', () => {
  const candles = trendingCandles(100, 1, 30);
  const rsi = calculateRSI(candles, 14);
  assert.equal(rsi, 100);
});

test('RSI returns 0 when prices fall monotonically', () => {
  const candles = trendingCandles(200, -1, 30);
  const rsi = calculateRSI(candles, 14);
  assert.equal(rsi, 0);
});

test('RSI returns 50 (neutral default) with insufficient data', () => {
  const candles = flatCandles(100, 5);
  const rsi = calculateRSI(candles, 14);
  assert.equal(rsi, 50);
});

test('RSI on flat prices (no gains/losses) is treated as overbought (100)', () => {
  const candles = flatCandles(100, 20);
  const rsi = calculateRSI(candles, 14);
  // avgGain = avgLoss = 0 -> avgLoss === 0 branch -> 100
  assert.equal(rsi, 100);
});

// ---------- MACD ----------
test('MACD on flat prices has zero histogram and neutral direction', () => {
  const candles = flatCandles(100, 60);
  const macd = calculateMACD(candles);
  assert.ok(Math.abs(macd.histogram) < 1e-9);
  assert.equal(macd.direction, 'neutral');
});

test('MACD on a sustained uptrend reports a bullish or rising histogram', () => {
  const candles = trendingCandles(100, 2, 60);
  const macd = calculateMACD(candles);
  assert.ok(macd.macd > 0, 'MACD line should be positive in an uptrend');
});

test('MACD with insufficient data returns the documented neutral default', () => {
  const candles = flatCandles(100, 10);
  const macd = calculateMACD(candles);
  assert.deepEqual(macd, { macd: 0, signal: 0, histogram: 0, direction: 'neutral' });
});

// ---------- ATR ----------
test('ATR equals the constant true range on uniform-range candles', () => {
  const candles = [];
  let close = 100;
  for (let i = 0; i < 20; i++) {
    const open = close;
    close = open; // no gap, so TR == high-low each bar
    candles.push(makeCandle(i, open, open + 5, open - 5, close));
  }
  const atr = calculateATR(candles, 14);
  assert.equal(round(atr, 4), 10);
});

test('ATR returns 0 with insufficient data', () => {
  const candles = flatCandles(100, 5);
  assert.equal(calculateATR(candles, 14), 0);
});

// ---------- Bollinger Bands ----------
test('Bollinger Bands collapse to the price when volatility is zero', () => {
  const candles = flatCandles(50, 25);
  const bb = calculateBollinger(candles, 20, 2);
  assert.equal(bb.upper, 50);
  assert.equal(bb.middle, 50);
  assert.equal(bb.lower, 50);
});

test('Bollinger Bands widen with volatility', () => {
  const candles = [];
  for (let i = 0; i < 25; i++) {
    const price = 100 + (i % 2 === 0 ? 10 : -10);
    candles.push(makeCandle(i, price, price, price, price));
  }
  const bb = calculateBollinger(candles, 20, 2);
  assert.ok(bb.upper > bb.middle);
  assert.ok(bb.lower < bb.middle);
});

// ---------- Supporting indicators used by the prediction engine ----------
test('volumeRatio reports 1 with insufficient history', () => {
  const candles = flatCandles(100, 5);
  assert.equal(volumeRatio(candles, 20), 1);
});

test('volumeRatio reflects a volume spike on the latest candle', () => {
  const candles = flatCandles(100, 21, 10);
  candles[candles.length - 1].volume = 50;
  const ratio = volumeRatio(candles, 20);
  assert.equal(ratio, 5);
});

test('detectCandlePattern identifies a Doji on a near-zero body candle', () => {
  const candles = [
    makeCandle(0, 100, 102, 98, 101),
    makeCandle(1, 101, 103, 99, 100),
    makeCandle(2, 100, 110, 90, 100.05),
  ];
  const pattern = detectCandlePattern(candles);
  assert.equal(pattern.name, 'Doji');
  assert.equal(pattern.bias, 'neutral');
});

test('detectCandlePattern identifies a Bullish Engulfing', () => {
  const candles = [
    makeCandle(0, 100, 101, 95, 96),
    makeCandle(1, 100, 101, 95, 96), // bearish candle: open 100, close 96
    makeCandle(2, 95, 102, 94, 101), // bullish candle engulfing the previous
  ];
  const pattern = detectCandlePattern(candles);
  assert.equal(pattern.name, 'Bullish Engulfing');
  assert.equal(pattern.bias, 'bullish');
});

test('calculatePivotPoints computes the classic pivot from recent high/low/close', () => {
  const candles = [
    makeCandle(0, 100, 110, 90, 100),
    makeCandle(1, 100, 105, 95, 100),
  ];
  const pivots = calculatePivotPoints(candles);
  // high=110 (from candle 0), low=90 (from candle 0), close=100 (last candle)
  const expectedPivot = (110 + 90 + 100) / 3;
  assert.equal(round(pivots.pivot, 4), round(expectedPivot, 4));
  assert.equal(round(pivots.r1, 4), round(2 * expectedPivot - 90, 4));
  assert.equal(round(pivots.s1, 4), round(2 * expectedPivot - 110, 4));
});

// ---------- sma / ema helpers ----------
test('sma returns null with insufficient data and the average otherwise', () => {
  assert.equal(sma([1, 2, 3], 5), null);
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
});

test('ema converges toward a constant series value', () => {
  const flat = new Array(50).fill(42);
  assert.equal(ema(flat, 9), 42);
});
