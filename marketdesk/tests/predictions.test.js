// Unit tests for the range-prediction engine.
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictRange, normalCdf, modelProbForTarget, combineProb, simulatePaperTrades, pavFit, pavApply } from '../cloudflare/src/predictions.js';

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
    assert.ok(p.explanation.includes('educational') || p.explanation.includes('educacional'));
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

test('normalCdf is well-behaved (monotone, symmetric, bounded)', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(normalCdf(-5) >= 0 && normalCdf(5) <= 1);
  assert.ok(normalCdf(1) > normalCdf(0) && normalCdf(0) > normalCdf(-1));
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 0.01);
});

test('modelProbForTarget: prob is higher when strike is below the midpoint', () => {
  const prediction = { midpoint: 100, range_low: 90, range_high: 110 };
  const below = modelProbForTarget(prediction, { strikeType: 'greater_or_equal', floorStrike: 90 });
  const above = modelProbForTarget(prediction, { strikeType: 'greater_or_equal', floorStrike: 110 });
  assert.ok(below > 0.5, 'P(>= below-midpoint strike) should exceed 0.5');
  assert.ok(above < 0.5, 'P(>= above-midpoint strike) should be under 0.5');
  assert.ok(below > above);
});

test('combineProb flags agreement, divergence, and value edges', () => {
  assert.equal(combineProb(0.7, 0.65).signal, 'AGREE_YES');
  assert.equal(combineProb(0.3, 0.4).signal, 'AGREE_NO');
  assert.equal(combineProb(0.7, 0.3).signal, 'DIVERGE');
  assert.equal(combineProb(0.7, null).signal, 'MODEL_ONLY');
  assert.equal(combineProb(null, 0.5).signal, 'NO_MODEL');
  assert.equal(combineProb(0.75, 0.6).value, 'yes_value'); // edge +0.15
  assert.equal(combineProb(0.4, 0.6).value, 'no_value');   // edge -0.20
});

test('simulatePaperTrades only trades on edge and accounts for fees/outcome', () => {
  const samples = [
    // edge +0.20 (model 70 vs market 50), YES, and it won → profitable
    { status: 'resolved', outcome: 1, marketProb: 0.5, modelProb: 0.7 },
    // edge below threshold → skipped
    { status: 'resolved', outcome: 1, marketProb: 0.5, modelProb: 0.54 },
    // pending → ignored
    { status: 'pending', outcome: null, marketProb: 0.5, modelProb: 0.9 },
  ];
  const r = simulatePaperTrades(samples, { edgeThreshold: 0.10, feeRate: 0.07, contracts: 1 });
  assert.equal(r.trades, 1);
  assert.equal(r.wins, 1);
  assert.equal(r.skipped, 1);
  // Won YES bought at 0.50: gross +0.50, minus fee 0.07*0.25=0.0175 → ~0.4825
  assert.ok(r.pnl > 0.47 && r.pnl < 0.49, `pnl ${r.pnl}`);
  assert.ok(r.roi > 0);
});

test('simulatePaperTrades returns zero trades when no edge clears threshold', () => {
  const r = simulatePaperTrades([{ status: 'resolved', outcome: 0, marketProb: 0.5, modelProb: 0.52 }]);
  assert.equal(r.trades, 0);
  assert.equal(r.pnl, 0);
});

test('pavFit produces a monotonic non-decreasing mapping even from noisy points', () => {
  const points = [
    { x: 0.15, y: 0.30, w: 10 },
    { x: 0.25, y: 0.10, w: 10 }, // violates monotonicity vs previous point
    { x: 0.45, y: 0.40, w: 20 },
    { x: 0.75, y: 0.85, w: 5 },
  ];
  const fit = pavFit(points);
  let prev = -1;
  for (const b of fit) {
    assert.ok(b.value >= prev - 1e-9, 'pooled values must be non-decreasing');
    prev = b.value;
  }
});

test('pavApply maps a raw probability through the pooled step function', () => {
  const fit = pavFit([{ x: 0.2, y: 0.2, w: 10 }, { x: 0.6, y: 0.6, w: 10 }, { x: 0.9, y: 0.9, w: 10 }]);
  assert.ok(Math.abs(pavApply(fit, 0.2) - 0.2) < 1e-9);
  assert.ok(Math.abs(pavApply(fit, 0.95) - 0.9) < 1e-9, 'out-of-range values clamp to the last block');
});
