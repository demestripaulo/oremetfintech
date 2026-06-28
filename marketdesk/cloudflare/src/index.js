import { fetchKlines, fetch24hTicker, SYMBOLS } from './binance.js';
import { buildIndicatorPanel } from './analysis.js';
import { predictRange, crossKalshiTargets } from './predictions.js';
import {
  getFearGreedIndex,
  getExternalIntelligence,
  getMarketNews,
  getKalshiTargets,
} from './connectors.js';

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
    return json({ symbol, log });
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
      } catch (err) {
        console.error('scheduled analysis failed for', symbol, err);
      }
    }
  },
};

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
