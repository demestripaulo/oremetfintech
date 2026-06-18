import { fetchKlines, fetch24hTicker, SYMBOLS } from './binance.js';
import { buildIndicatorPanel } from './analysis.js';
import { predictRange } from './predictions.js';
import {
  getDanelfinPanel,
  getDanelfinScore,
  getFearGreedIndex,
  getExternalIntelligence,
  getMarketNews,
} from './connectors.js';
import {
  setTrendspiderConfig,
  getTrendspiderConfig,
  getLog as getTrendspiderLog,
  testConnection as testTrendspiderConnection,
  handleInboundWebhook,
  sendAlertToTrendspider,
} from './trendspider.js';
import { buildSystemPrompt, buildSnapshot, resolveToolUse, streamFinalAnswer } from './chat.js';

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
    const candles = await fetchKlines(symbol, interval, limit);
    return json({ symbol, interval, candles });
  }

  if (url.pathname === '/api/analysis') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const lang = url.searchParams.get('lang') || 'en';
    const candles = await fetchKlines(symbol, '1m', 200);
    const indicators = buildIndicatorPanel(candles, lang);
    return json({ symbol, indicators });
  }

  if (url.pathname === '/api/predictions') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const lang = url.searchParams.get('lang') || 'en';
    const candles = await fetchKlines(symbol, '1m', 200);
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
  if (url.pathname === '/api/connectors/danelfin') {
    return json(await getDanelfinPanel(env.DANELFIN_API_KEY));
  }

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

  // ---------- TrendSpider webhooks ----------
  if (url.pathname === '/webhooks/trendspider' && request.method === 'POST') {
    const payload = await request.json().catch(() => ({}));
    const result = await handleInboundWebhook(env, payload);
    await broadcastToHub(env, { type: 'system_event', eventType: 'trendspider', ...result, payload });
    return json({ received: true, ...result });
  }

  if (url.pathname === '/api/trendspider/config') {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return json(await setTrendspiderConfig(env, body));
    }
    return json(await getTrendspiderConfig(env));
  }

  if (url.pathname === '/api/trendspider/log') {
    return json({ log: await getTrendspiderLog(env) });
  }

  if (url.pathname === '/api/trendspider/test' && request.method === 'POST') {
    return json(await testTrendspiderConnection(env));
  }

  // ---------- AI Chat (Workers AI, streaming with tool use) ----------
  if (url.pathname === '/api/chat' && request.method === 'POST') {
    return handleChat(request, env);
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
        const candles = await fetchKlines(symbol, '1m', 200);
        const indicators = buildIndicatorPanel(candles);
        const fifteenMin = predictRange(candles, '15min');
        const oneHour = predictRange(candles, '1h');
        const daily = predictRange(candles, 'daily');
        await persistPredictionLog(env, {
          symbol,
          generatedAt: Date.now(),
          fifteenMin,
          oneHour,
          daily,
          priceAtGeneration: candles[candles.length - 1].close,
        });

        if (indicators.pattern.bias !== 'neutral') {
          await sendAlertToTrendspider(env, {
            source: 'marketdesk',
            symbol,
            alert_type: 'pattern_detected',
            pattern: indicators.pattern.name,
            bias: indicators.pattern.bias,
            price: indicators.price,
            timestamp: new Date().toISOString(),
          });
        }
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

async function broadcastToHub(env, payload) {
  const id = env.MARKET_HUB.idFromName('global');
  const stub = env.MARKET_HUB.get(id);
  await stub.fetch('https://internal/broadcast', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function buildToolExecutors(env, defaultSymbol) {
  return {
    get_current_price: async ({ symbol } = {}) => {
      const sym = (symbol || defaultSymbol).toUpperCase();
      const candles = await fetchKlines(sym, '1m', 200);
      return { symbol: sym, ...buildIndicatorPanel(candles) };
    },
    get_danelfin_score: async ({ ticker }) => getDanelfinScore(ticker, env.DANELFIN_API_KEY),
    get_fear_greed: async () => getFearGreedIndex(),
    get_price_prediction: async ({ interval } = {}) => {
      const candles = await fetchKlines(defaultSymbol, '1m', 200);
      return predictRange(candles, interval === '4h' ? '1h' : interval || '15min');
    },
    get_support_resistance: async () => {
      const candles = await fetchKlines(defaultSymbol, '1m', 200);
      return buildIndicatorPanel(candles).pivots;
    },
    get_recent_news: async ({ asset } = {}) => getMarketNews(asset),
  };
}

async function handleChat(request, env) {
  if (!env.AI) {
    return json({ error: 'Workers AI não está disponível neste Worker (binding "AI" ausente).' }, 500);
  }
  try {
    const { messages, symbol = 'BTCUSDT' } = await request.json();
    const candles = await fetchKlines(symbol, '1m', 200);
    const indicators = buildIndicatorPanel(candles);
    const predictions = {
      fifteenMin: predictRange(candles, '15min'),
      oneHour: predictRange(candles, '1h'),
    };
    const snapshot = buildSnapshot(indicators, predictions, symbol);
    const system = buildSystemPrompt(snapshot);
    const toolExecutors = await buildToolExecutors(env, symbol);

    const { messages: resolvedMessages, toolTrace } = await resolveToolUse({
      ai: env.AI,
      system,
      messages,
      toolExecutors,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`event: tool_trace\ndata: ${JSON.stringify(toolTrace)}\n\n`));
        try {
          await streamFinalAnswer({
            ai: env.AI,
            system,
            messages: resolvedMessages,
            onChunk: (line) => controller.enqueue(encoder.encode(line + '\n')),
          });
        } catch (err) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`));
        }
        controller.close();
      },
    });

    return cors(
      new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    );
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
