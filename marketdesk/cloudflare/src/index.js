import { fetchKlines, fetch24hTicker, SYMBOLS } from './binance.js';
import { buildIndicatorPanel } from './analysis.js';
import { predictRange } from './predictions.js';

export { MarketHub } from './websocket.js';

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
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

export default {
  async fetch(request, env, ctx) {
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
      const candles = await fetchKlines(symbol, interval, limit);
      return json({ symbol, interval, candles });
    }

    if (url.pathname === '/api/analysis') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const candles = await fetchKlines(symbol, '1m', 200);
      const indicators = buildIndicatorPanel(candles);
      return json({ symbol, indicators });
    }

    if (url.pathname === '/api/predictions') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const candles = await fetchKlines(symbol, '1m', 200);
      const fifteenMin = predictRange(candles, '15min');
      const oneHour = predictRange(candles, '1h');
      const record = { symbol, generatedAt: Date.now(), fifteenMin, oneHour };
      await persistPredictionLog(env, record);
      return json(record);
    }

    if (url.pathname === '/api/history') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const log = await readPredictionLog(env, symbol);
      return json({ symbol, log });
    }

    return json({ error: 'Not found' }, 404);
  },

  // Cron Trigger: runs every 15 minutes (see wrangler.toml) to refresh and
  // persist predictions for all tracked symbols, enabling retrospective accuracy checks.
  async scheduled(event, env, ctx) {
    for (const symbol of SYMBOLS) {
      try {
        const candles = await fetchKlines(symbol, '1m', 200);
        const fifteenMin = predictRange(candles, '15min');
        const oneHour = predictRange(candles, '1h');
        await persistPredictionLog(env, {
          symbol,
          generatedAt: Date.now(),
          fifteenMin,
          oneHour,
          priceAtGeneration: candles[candles.length - 1].close,
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
