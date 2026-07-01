import { fetchKlines, fetch24hTicker, SYMBOLS } from './binance.js';
import { buildIndicatorPanel } from './analysis.js';
import { predictRange, crossKalshiTargets, modelProbForTarget, simulatePaperTrades, pavFit, pavApply } from './predictions.js';
import {
  getFearGreedIndex,
  getExternalIntelligence,
  getMarketNews,
  getKalshiTargets,
} from './connectors.js';

// Assets that have Kalshi 15-min directional markets we calibrate against.
const KALSHI_ASSETS = ['BTC', 'ETH'];

export { MarketHub } from './websocket.js';

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}

function json(data, status = 200) {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

// All routing lives here so the top-level fetch() can wrap it in a single
// try/catch and guarantee a JSON error response instead of letting Cloudflare
// return an HTML error page (which breaks JSON.parse in the frontend).
async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }

  if (url.pathname === '/ws') {
    const id = env.MARKET_HUB.idFromName('global');
    const stub = env.MARKET_HUB.get(id);
    return stub.fetch(request);
  }

  if (url.pathname === '/api/symbols') {
    return json({ symbols: SYMBOLS });
  }

  if (url.pathname === '/api/tickers') {
    const tickers = await Promise.all(SYMBOLS.map((s) => fetch24hTicker(s)));
    return json({ tickers });
  }

  if (url.pathname === '/api/candles') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const interval = url.searchParams.get('interval') || '1m';
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10));
    const { candles, source } = await fetchKlines(symbol, interval, limit);
    return json({ symbol, interval, candles, source });
  }

  if (url.pathname === '/api/analysis') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const lang = url.searchParams.get('lang') || 'en';
    const interval = url.searchParams.get('interval') || '1m';
    const { candles } = await fetchKlines(symbol, interval, 200);
    const indicators = buildIndicatorPanel(candles, lang);
    return json({ symbol, indicators });
  }

  if (url.pathname === '/api/predictions') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const lang = url.searchParams.get('lang') || 'en';
    const { candles } = await fetchKlines(symbol, '1m', 200);
    const fifteenMin = predictRange(candles, '15min', lang);
    const oneHour = predictRange(candles, '1h', lang);
    const daily = predictRange(candles, 'daily', lang);
    const currentPrice = candles[candles.length - 1].close;
    // Seed the accuracy tracker (deduped append by window) so the before/after
    // log fills even between cron ticks. Resolution is left to the cron — a
    // single writer — to avoid a read-modify-write race overwriting resolved rows.
    await recordPredictions(env, symbol, {
      '15min': { ...fifteenMin, priceAtGeneration: currentPrice },
      '1h': { ...oneHour, priceAtGeneration: currentPrice },
    });
    return json({ symbol, generatedAt: Date.now(), fifteenMin, oneHour, daily });
  }

  if (url.pathname === '/api/history') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const log = await readPredictionLog(env, symbol);
    const calibRaw = await env.MARKET_KV.get(`calib:${symbol}`);
    const calib = calibRaw ? JSON.parse(calibRaw) : [];
    return json({ symbol, log, calib });
  }

  // ---------- External connectors ----------
  if (url.pathname === '/api/connectors/fear-greed') {
    return json(await getFearGreedIndex());
  }

  if (url.pathname === '/api/connectors/intelligence') {
    return json(await getExternalIntelligence(env));
  }

  if (url.pathname === '/api/connectors/news') {
    const asset = url.searchParams.get('asset');
    const items = await getMarketNews(asset);
    return json({ items });
  }

  if (url.pathname === '/api/connectors/kalshi') {
    const asset = url.searchParams.get('asset') || 'BTC';
    const price = url.searchParams.get('price');
    const horizon = url.searchParams.get('horizon') || '15m';
    const result = await getKalshiTargets(asset, price, horizon);
    // Cross with the internal model: attach model prob + agreement verdict.
    if (!result.error && Array.isArray(result.targets) && result.targets.length > 0) {
      try {
        const symbol = `${asset.toUpperCase()}USDT`;
        const { candles } = await fetchKlines(symbol, '1m', 200);
        const prediction = predictRange(candles, horizon === '1h' ? '1h' : '15min');
        crossKalshiTargets(prediction, result.targets);
        result.model = {
          midpoint: prediction.midpoint,
          range_low: prediction.range_low,
          range_high: prediction.range_high,
          bias: prediction.bias,
        };
      } catch (err) {
        console.error('Kalshi model cross failed', err);
      }
    }
    return json(result);
  }

  if (url.pathname === '/api/calibration') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const raw = await env.MARKET_KV.get(`calib:${symbol}`);
    const log = raw ? JSON.parse(raw) : [];
    return json({ symbol, ...calibrationSummary(log) });
  }

  if (url.pathname === '/api/paper') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const raw = await env.MARKET_KV.get(`calib:${symbol}`);
    const log = raw ? JSON.parse(raw) : [];
    return json({ symbol, ...simulatePaperTrades(log) });
  }

  // Anything else (/, /css/*, /js/*, ...) is the static frontend bundle.
  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled Worker error', err);
      return json({ error: `Erro ao processar requisição: ${err.message}` }, 500);
    }
  },

  // Cron Trigger: runs every 15 minutes (see wrangler.toml) to refresh and
  // persist predictions for all tracked symbols, enabling retrospective accuracy checks.
  async scheduled(event, env, ctx) {
    for (const symbol of SYMBOLS) {
      try {
        const { candles } = await fetchKlines(symbol, '1m', 200);
        const fifteenMin = predictRange(candles, '15min');
        const oneHour = predictRange(candles, '1h');
        const currentPrice = candles[candles.length - 1].close;

        // Resolve any window that has closed, then record this window's forecast.
        await resolvePredictions(env, symbol, candles);
        await recordPredictions(env, symbol, {
          '15min': { ...fifteenMin, priceAtGeneration: currentPrice },
          '1h': { ...oneHour, priceAtGeneration: currentPrice },
        });

        // Calibration: for BTC/ETH, record the model-vs-market directional
        // prediction for the live 15-min window, and resolve closed ones.
        const asset = symbol.replace('USDT', '');
        if (KALSHI_ASSETS.includes(asset)) {
          await resolveCalibration(env, symbol, candles);
          const kalshi = await getKalshiTargets(asset, currentPrice, '15m');
          const tgt = kalshi && !kalshi.error && Array.isArray(kalshi.targets) ? kalshi.targets[0] : null;
          if (tgt && tgt.openTime && tgt.closeTime && (tgt.floorStrike != null || tgt.capStrike != null)) {
            await recordCalibration(env, symbol, {
              interval: '15min',
              windowStart: new Date(tgt.openTime).getTime(),
              windowEnd: new Date(tgt.closeTime).getTime(),
              strike: tgt.floorStrike ?? tgt.capStrike,
              strikeType: tgt.strikeType,
              capStrike: tgt.capStrike,
              marketProb: tgt.impliedProb,
              modelProb: modelProbForTarget(fifteenMin, tgt),
            });
          }
        }
      } catch (err) {
        console.error('scheduled analysis failed for', symbol, err);
      }
    }
  },
};

// ---------- Calibration tracker (directional, 15-min) ----------
const MAX_CALIB_ENTRIES = 500;

async function recordCalibration(env, symbol, sample) {
  const key = `calib:${symbol}`;
  const raw = await env.MARKET_KV.get(key);
  const log = raw ? JSON.parse(raw) : [];
  if (log.some((e) => e.interval === sample.interval && e.windowStart === sample.windowStart)) return;
  log.push({ ...sample, outcome: null, status: 'pending' });
  while (log.length > MAX_CALIB_ENTRIES) log.shift();
  await env.MARKET_KV.put(key, JSON.stringify(log));
}

async function resolveCalibration(env, symbol, candles) {
  const key = `calib:${symbol}`;
  const raw = await env.MARKET_KV.get(key);
  if (!raw) return;
  const log = JSON.parse(raw);
  const byTime = new Map(candles.map((c) => [c.time, c]));
  const priceAt = (tSec) => byTime.get(tSec)?.open ?? byTime.get(tSec - 60)?.close ?? null;
  const newest = candles.length ? candles[candles.length - 1].close : null;
  const now = Date.now();
  const GRACE = 5 * 60 * 1000;
  let changed = false;
  for (const e of log) {
    if (e.status !== 'pending' || now < e.windowEnd) continue;
    let actual = priceAt(Math.floor(e.windowEnd / 1000));
    if (actual == null) { if (now < e.windowEnd + GRACE || newest == null) continue; actual = newest; }
    // Directional outcome: did settlement satisfy the target?
    let hit;
    const type = e.strikeType || 'greater_or_equal';
    if (type === 'between' && e.strike != null && e.capStrike != null) hit = actual >= e.strike && actual <= e.capStrike;
    else if (type.startsWith('less')) hit = actual <= (e.capStrike ?? e.strike);
    else hit = actual >= e.strike;
    e.outcome = hit ? 1 : 0;
    e.resolved_price = actual;
    e.status = 'resolved';
    changed = true;
  }
  if (changed) await env.MARKET_KV.put(key, JSON.stringify(log));
}

// Brier score (lower = better) + reliability buckets for model vs market.
function calibrationSummary(log) {
  const resolved = log.filter((e) => e.status === 'resolved' && typeof e.outcome === 'number');
  const n = resolved.length;
  const brier = (probKey) => {
    const xs = resolved.filter((e) => typeof e[probKey] === 'number');
    if (xs.length === 0) return null;
    return xs.reduce((a, e) => a + (e[probKey] - e.outcome) ** 2, 0) / xs.length;
  };
  // Hit-rate by predicted-probability bucket, for a reliability curve.
  const bucketsBy = (probKey) => {
    const out = [];
    for (let b = 0; b < 10; b++) {
      const lo = b / 10, hi = (b + 1) / 10;
      const xs = resolved.filter((e) => typeof e[probKey] === 'number' && e[probKey] >= lo && e[probKey] < (hi === 1 ? 1.0001 : hi));
      if (xs.length) out.push({ bucket: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, lo, hi, n: xs.length, observed: round01(xs.reduce((a, e) => a + e.outcome, 0) / xs.length) });
    }
    return out;
  };
  const buckets = bucketsBy('marketProb');       // kept for back-compat
  const modelBuckets = bucketsBy('modelProb');

  const modelBrier = brier('modelProb');
  const marketBrier = brier('marketProb');
  // Skill score: how much the model beats the market (>0 = better than market).
  const skill = modelBrier != null && marketBrier ? round01(1 - modelBrier / marketBrier) : null;

  // In-sample isotonic recalibration: map raw modelProb through the observed
  // frequency of its own reliability bucket (pool-adjacent-violators keeps it
  // monotonic). Shows how much of the Brier gap is fixable by recalibration
  // alone vs. a genuine modeling problem. Not leave-one-out — illustrative only.
  let recalModelBrier = null, recalSkillVsMarket = null;
  const modelSamples = resolved.filter((e) => typeof e.modelProb === 'number');
  if (modelBuckets.length >= 2 && modelSamples.length) {
    const fit = pavFit(modelBuckets.map((b) => ({ x: (b.lo + b.hi) / 2, y: b.observed, w: b.n })));
    const sqErr = modelSamples.reduce((a, e) => a + (pavApply(fit, e.modelProb) - e.outcome) ** 2, 0);
    recalModelBrier = r3(sqErr / modelSamples.length);
    recalSkillVsMarket = marketBrier ? round01(1 - recalModelBrier / marketBrier) : null;
  }

  return {
    samples: n,
    modelBrier: r3(modelBrier),
    marketBrier: r3(marketBrier),
    skillVsMarket: skill,
    recalModelBrier,
    recalSkillVsMarket,
    buckets,
    modelBuckets,
  };
}
function r3(x) { return x == null ? null : Math.round(x * 1000) / 1000; }
function round01(x) { return Math.round(x * 100) / 100; }

// Holds ~1.5 days of flat per-horizon records (15min + 1h ≈ 5/hour/symbol).
const MAX_LOG_ENTRIES = 200;

// Horizon window length in ms. 'daily' is excluded from the accuracy tracker —
// it needs a 5PM-ET trigger and is a live-forecast-only panel.
const HORIZON_MS = { '15min': 15 * 60 * 1000, '1h': 60 * 60 * 1000 };

// Align a timestamp down to the start of its horizon window.
function windowBounds(interval, now) {
  const span = HORIZON_MS[interval];
  const start = Math.floor(now / span) * span;
  return { windowStart: start, windowEnd: start + span };
}

async function readPredictionLog(env, symbol) {
  const raw = await env.MARKET_KV.get(`log:${symbol}`);
  return raw ? JSON.parse(raw) : [];
}

// Record the window-START prediction for each tracked horizon. De-duped by
// (interval, windowStart): the first prediction seen for a window is kept, so
// the log reflects "what was forecast at the start of the window" — later ticks
// within the same window do not overwrite it.
async function recordPredictions(env, symbol, predictions, now = Date.now()) {
  const key = `log:${symbol}`;
  const log = await readPredictionLog(env, symbol);
  let changed = false;

  for (const [interval, p] of Object.entries(predictions)) {
    if (!HORIZON_MS[interval] || !p) continue;
    const { windowStart, windowEnd } = windowBounds(interval, now);
    const exists = log.some(e => e.interval === interval && e.windowStart === windowStart);
    if (exists) continue;
    log.push({
      symbol,
      interval,
      windowStart,
      windowEnd,
      generatedAt: now,
      priceAtGeneration: p.priceAtGeneration ?? null,
      range_low: p.range_low,
      range_high: p.range_high,
      midpoint: p.midpoint,
      bias: p.bias,
      confidence: p.confidence,
      resolved_price: null,
      hit: null,
      status: 'pending',
    });
    changed = true;
  }

  while (log.length > MAX_LOG_ENTRIES) log.shift();
  if (changed) await env.MARKET_KV.put(key, JSON.stringify(log));
}

// Resolve any pending record whose window has closed, using the ACTUAL price at
// window end taken from the 1-minute candle series (not the current tick), so a
// 15min and an hourly prediction are each scored at their own correct boundary.
async function resolvePredictions(env, symbol, candles) {
  const key = `log:${symbol}`;
  const log = await readPredictionLog(env, symbol);
  if (log.length === 0) return;

  // time(seconds) -> candle, for O(1) window-end price lookup.
  const byTime = new Map(candles.map(c => [c.time, c]));
  const priceAt = (tSec) => {
    const atBoundary = byTime.get(tSec);        // candle opening at the boundary
    if (atBoundary) return atBoundary.open;     // open == price exactly at window end
    const lastInWindow = byTime.get(tSec - 60); // else close of the final 1m candle
    return lastInWindow ? lastInWindow.close : null;
  };

  const now = Date.now();
  const newest = candles.length ? candles[candles.length - 1].close : null;
  // After this grace period, resolve against the best price we have rather than
  // leaving a row stuck on "pending" forever (e.g. a candle gap right at the
  // boundary, or the boundary scrolling out of the 200-candle window).
  const RESOLVE_GRACE_MS = 5 * 60 * 1000;
  let changed = false;
  for (const e of log) {
    if (e.status !== 'pending') continue;
    if (now < e.windowEnd) continue;
    let actual = priceAt(Math.floor(e.windowEnd / 1000));
    if (actual == null) {
      if (now < e.windowEnd + RESOLVE_GRACE_MS || newest == null) continue; // retry on a later tick
      actual = newest; // fallback: don't leave it pending indefinitely
    }
    e.resolved_price = actual;
    e.hit = actual >= e.range_low && actual <= e.range_high;
    e.status = 'resolved';
    changed = true;
  }
  if (changed) await env.MARKET_KV.put(key, JSON.stringify(log));
}
