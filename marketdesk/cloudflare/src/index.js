import { fetchKlines, fetch24hTicker, SYMBOLS } from './binance.js';
import { buildIndicatorPanel } from './analysis.js';
import { predictRange } from './predictions.js';
import {
  getFearGreedIndex,
  getExternalIntelligence,
  getMarketNews,
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
    const record = { symbol, generatedAt: Date.now(), fifteenMin, oneHour, daily };
    await persistPredictionLog(env, record);
    return json(record);
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
        const indicators = buildIndicatorPanel(candles);
        const fifteenMin = predictRange(candles, '15min');
        const oneHour = predictRange(candles, '1h');
        const daily = predictRange(candles, 'daily');
        const currentPrice = candles[candles.length - 1].close;

        // Resolve past entries whose 15-min window has closed.
        await resolvePastPredictions(env, symbol, currentPrice);

        await persistPredictionLog(env, {
          symbol,
          generatedAt: Date.now(),
          fifteenMin,
          oneHour,
          daily,
          priceAtGeneration: currentPrice,
        });
      } catch (err) {
        console.error('scheduled analysis failed for', symbol, err);
      }
    }
  },
};

const MAX_LOG_ENTRIES = 24;

async function persistPredictionLog(env, record) {
  const key = `log:${record.symbol}`;
  const existingRaw = await env.MARKET_KV.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : [];
  existing.push(record);
  while (existing.length > MAX_LOG_ENTRIES) existing.shift();
  await env.MARKET_KV.put(key, JSON.stringify(existing));
}

async function readPredictionLog(env, symbol) {
  const raw = await env.MARKET_KV.get(`log:${symbol}`);
  return raw ? JSON.parse(raw) : [];
}

// For each unresolved entry whose 15-min window has expired, stamp resolved_price
// and mark whether the actual price fell inside the predicted range.
async function resolvePastPredictions(env, symbol, currentPrice) {
  const key = `log:${symbol}`;
  const raw = await env.MARKET_KV.get(key);
  if (!raw) return;
  const log = JSON.parse(raw);
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const now = Date.now();
  let changed = false;
  for (const entry of log) {
    if (entry.resolved_price != null) continue;
    if (now - entry.generatedAt < FIFTEEN_MIN_MS) continue;
    const low  = entry.fifteenMin?.range_low;
    const high = entry.fifteenMin?.range_high;
    if (low == null || high == null) continue;
    entry.resolved_price = currentPrice;
    entry.hit = currentPrice >= low && currentPrice <= high;
    changed = true;
  }
  if (changed) await env.MARKET_KV.put(key, JSON.stringify(log));
}
