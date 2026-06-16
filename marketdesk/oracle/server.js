import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { buildIndicatorPanel } from './analysis.js';
import { predictRange } from './predictions.js';
import { insertPrediction, latestPredictions, resolveDuePredictions } from './db.js';
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
  sendAlertToTrendspider,
  testConnection as testTrendspiderConnection,
  handleInboundWebhook,
} from './trendspider.js';
import { buildSystemPrompt, buildSnapshot, resolveToolUse, streamFinalAnswer } from './chat.js';

const PORT = process.env.PORT || 8080;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DANELFIN_API_KEY = process.env.DANELFIN_API_KEY;
const GLASSNODE_API_KEY = process.env.GLASSNODE_API_KEY;
const SYMBOLS = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt'];
const BINANCE_REST = 'https://api.binance.com/api/v3';
const CACHE_TTL_MS = 5000;
const MIN_REQUEST_INTERVAL_MS = 120;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.static('../frontend'));

// ---------- Rate-limited, cached REST fetch helpers ----------
const cache = new Map();
let lastRequestAt = 0;

async function throttledFetch(url) {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  return res.json();
}

function cached(key, ttl, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return Promise.resolve(entry.data);
  return fn().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

const INTERVAL_MAP = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d' };

async function fetchKlines(symbol, interval = '1m', limit = 200) {
  const binanceInterval = INTERVAL_MAP[interval] || interval;
  return cached(`klines:${symbol}:${binanceInterval}:${limit}`, CACHE_TTL_MS, async () => {
    const url = `${BINANCE_REST}/klines?symbol=${symbol.toUpperCase()}&interval=${binanceInterval}&limit=${limit}`;
    const raw = await throttledFetch(url);
    return raw.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  });
}

async function fetch24hTicker(symbol) {
  return cached(`ticker:${symbol}`, CACHE_TTL_MS, async () => {
    const url = `${BINANCE_REST}/ticker/24hr?symbol=${symbol.toUpperCase()}`;
    const data = await throttledFetch(url);
    return {
      symbol: data.symbol,
      price: parseFloat(data.lastPrice),
      changePercent: parseFloat(data.priceChangePercent),
      volume: parseFloat(data.volume),
    };
  });
}

// ---------- REST API ----------
app.get('/api/symbols', (req, res) => res.json({ symbols: SYMBOLS.map((s) => s.toUpperCase()) }));

app.get('/api/tickers', async (req, res) => {
  try {
    const tickers = await Promise.all(SYMBOLS.map((s) => fetch24hTicker(s)));
    res.json({ tickers });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/candles', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSDT';
    const interval = req.query.interval || '1m';
    const limit = Math.min(500, parseInt(req.query.limit || '200', 10));
    const candles = await fetchKlines(symbol, interval, limit);
    res.json({ symbol, interval, candles });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/analysis', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSDT';
    const candles = await fetchKlines(symbol, '1m', 200);
    const indicators = buildIndicatorPanel(candles);
    res.json({ symbol, indicators });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/predictions', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const candles = await fetchKlines(symbol, '1m', 200);
    const price = candles[candles.length - 1].close;
    const fifteenMin = predictRange(candles, '15min');
    const oneHour = predictRange(candles, '1h');
    const now = Date.now();
    insertPrediction({ symbol, generated_at: now, interval: '15min', range_low: fifteenMin.range_low, range_high: fifteenMin.range_high, midpoint: fifteenMin.midpoint, bias: fifteenMin.bias, confidence: fifteenMin.confidence, explanation: fifteenMin.explanation, price_at_generation: price });
    insertPrediction({ symbol, generated_at: now, interval: '1h', range_low: oneHour.range_low, range_high: oneHour.range_high, midpoint: oneHour.midpoint, bias: oneHour.bias, confidence: oneHour.confidence, explanation: oneHour.explanation, price_at_generation: price });
    res.json({ symbol, generatedAt: now, fifteenMin, oneHour });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const candles = await fetchKlines(symbol, '1m', 5);
    resolveDuePredictions(symbol, candles[candles.length - 1].close);
    const log = latestPredictions(symbol, 48);
    res.json({ symbol, log });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- External connectors ----------
app.get('/api/connectors/danelfin', async (req, res) => {
  const panel = await getDanelfinPanel(DANELFIN_API_KEY);
  res.json(panel);
});

app.get('/api/connectors/fear-greed', async (req, res) => {
  const data = await getFearGreedIndex();
  res.json(data);
});

app.get('/api/connectors/intelligence', async (req, res) => {
  const data = await getExternalIntelligence({ GLASSNODE_API_KEY });
  res.json(data);
});

app.get('/api/connectors/news', async (req, res) => {
  const asset = req.query.asset;
  const items = await getMarketNews(asset);
  res.json({ items });
});

// ---------- TrendSpider webhooks (bidirectional) ----------
app.post('/webhooks/trendspider', (req, res) => {
  const result = handleInboundWebhook(req.body || {});
  broadcastSystemEvent({ eventType: 'trendspider', ...result, payload: req.body });
  res.json({ received: true });
});

app.get('/api/trendspider/config', (req, res) => res.json(getTrendspiderConfig()));

app.post('/api/trendspider/config', (req, res) => {
  const { url, enabled } = req.body || {};
  res.json(setTrendspiderConfig({ url, enabled }));
});

app.get('/api/trendspider/log', (req, res) => res.json({ log: getTrendspiderLog() }));

app.post('/api/trendspider/test', async (req, res) => {
  const result = await testTrendspiderConnection();
  res.json(result);
});

// ---------- AI Chat (Claude, streaming with tool use) ----------
async function buildToolExecutors(defaultSymbol) {
  return {
    get_current_price: async ({ symbol } = {}) => {
      const sym = (symbol || defaultSymbol).toUpperCase();
      const candles = await fetchKlines(sym, '1m', 200);
      return { symbol: sym, ...buildIndicatorPanel(candles) };
    },
    get_danelfin_score: async ({ ticker }) => getDanelfinScore(ticker, DANELFIN_API_KEY),
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

app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' });
    return;
  }
  try {
    const { messages, symbol = 'BTCUSDT' } = req.body || {};
    const candles = await fetchKlines(symbol, '1m', 200);
    const indicators = buildIndicatorPanel(candles);
    const predictions = {
      fifteenMin: predictRange(candles, '15min'),
      oneHour: predictRange(candles, '1h'),
    };
    const snapshot = buildSnapshot(indicators, predictions, symbol);
    const system = buildSystemPrompt(snapshot);
    const toolExecutors = await buildToolExecutors(symbol);

    const { messages: resolvedMessages, toolTrace } = await resolveToolUse({
      apiKey: ANTHROPIC_API_KEY,
      system,
      messages,
      toolExecutors,
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: tool_trace\ndata: ${JSON.stringify(toolTrace)}\n\n`);

    await streamFinalAnswer({
      apiKey: ANTHROPIC_API_KEY,
      system,
      messages: resolvedMessages,
      onChunk: (line) => res.write(line + '\n'),
    });

    res.end();
  } catch (err) {
    console.error('Chat error', err);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

function broadcastSystemEvent(event) {
  const msg = JSON.stringify({ type: 'system_event', ...event });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// ---------- Periodic analysis (every 15 minutes), mirrors the Cloudflare Cron Trigger ----------
setInterval(async () => {
  for (const symbol of SYMBOLS) {
    const sym = symbol.toUpperCase();
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/predictions?symbol=${sym}`);
      const candles = await fetchKlines(sym, '1m', 200);
      const indicators = buildIndicatorPanel(candles);
      if (indicators.pattern.bias !== 'neutral') {
        await sendAlertToTrendspider({
          source: 'marketdesk',
          symbol: sym,
          alert_type: 'pattern_detected',
          pattern: indicators.pattern.name,
          bias: indicators.pattern.bias,
          price: indicators.price,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('periodic analysis failed for', symbol, err.message);
    }
  }
}, 15 * 60 * 1000);

// ---------- WebSocket relay: upstream Binance combined stream -> connected browsers ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let upstream = null;
let upstreamAttempts = 0;
const lastTicks = new Map();

function broadcast(tick) {
  const msg = JSON.stringify(tick);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function connectUpstream() {
  const streamUrl =
    'wss://stream.binance.com:9443/stream?streams=' +
    SYMBOLS.map((s) => `${s}@kline_1m`).join('/');

  upstream = new WebSocket(streamUrl);

  upstream.on('open', () => {
    upstreamAttempts = 0;
    console.log('Connected to Binance upstream stream');
  });

  upstream.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const k = payload.data && payload.data.k;
    if (!k) return;
    const tick = {
      type: 'kline',
      symbol: k.s,
      interval: k.i,
      isFinal: k.x,
      candle: {
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
      },
    };
    lastTicks.set(tick.symbol, tick);
    broadcast(tick);
  });

  const scheduleReconnect = () => {
    upstreamAttempts += 1;
    const delay = Math.min(30000, 1000 * 2 ** upstreamAttempts);
    console.warn(`Upstream disconnected, reconnecting in ${delay}ms`);
    setTimeout(connectUpstream, delay);
  };

  upstream.on('close', scheduleReconnect);
  upstream.on('error', scheduleReconnect);
}

wss.on('connection', (ws) => {
  for (const tick of lastTicks.values()) {
    ws.send(JSON.stringify(tick));
  }
});

connectUpstream();

server.listen(PORT, () => {
  console.log(`MarketDesk Oracle backend listening on port ${PORT}`);
});
