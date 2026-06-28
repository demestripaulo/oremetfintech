// Durable Object that maintains a live upstream WebSocket and fans out ticks
// to every browser client. Primary source: Kraken WebSocket.
// Fallback: Coinbase Advanced Trade WebSocket.
// Binance is intentionally excluded — it blocks Cloudflare IP ranges.

const COINBASE_WS = 'wss://advanced-trade-ws.coinbase.com';
const KRAKEN_WS = 'wss://ws.kraken.com';

// Coinbase product IDs for each tracked symbol.
const COINBASE_PRODUCTS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD'];

// Kraken pair names (BNB not listed on Kraken).
const KRAKEN_PAIRS = ['XBT/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'];

// Map Coinbase product → our standard USDT symbol.
const COINBASE_TO_SYMBOL = {
  'BTC-USD': 'BTCUSDT',
  'ETH-USD': 'ETHUSDT',
  'SOL-USD': 'SOLUSDT',
  'XRP-USD': 'XRPUSDT',
};

// Map Kraken pair name → our standard USDT symbol.
const KRAKEN_TO_SYMBOL = {
  'XBT/USD': 'BTCUSDT',
  'XBTUSD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'ETHUSD': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT',
  'SOLUSD': 'SOLUSDT',
  'XRP/USD': 'XRPUSDT',
  'XRPUSD': 'XRPUSDT',
};

export class MarketHub {
  // Max one broadcast per symbol per this interval. ~1s keeps the chart pulse
  // smooth while capping browser repaint work an order of magnitude below the
  // raw upstream rate.
  static FLUSH_INTERVAL_MS = 1000;

  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set();
    this.upstream = null;
    this.upstreamReconnectAttempts = 0;
    this.lastTicks = new Map();
    // 'kraken' | 'coinbase'
    this.activeSource = 'kraken';
    // Accumulate partial candle state per symbol (Coinbase sends trades, not klines).
    this.partialCandles = new Map();
    // Bucket start time (floored to 1-minute boundary) per symbol.
    this.bucketStart = new Map();
    // Coalesced broadcast: upstream sources push 10-40 msg/s per symbol, far more
    // than any browser (especially low-end) can repaint. We accumulate the latest
    // candle state and flush at most once per FLUSH_INTERVAL_MS, sending each
    // dirty symbol's newest tick exactly once. This is the single biggest lever
    // for keeping weak clients responsive.
    this.dirtySymbols = new Set();
    this.flushTimer = null;
  }

  // Mark a symbol's tick dirty and ensure a flush is scheduled.
  scheduleFlush(symbol) {
    // No browsers connected — don't run a perpetual timer over an empty Set.
    // The next client connect gets the latest snapshot from lastTicks anyway.
    if (this.clients.size === 0) return;
    this.dirtySymbols.add(symbol);
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const sym of this.dirtySymbols) {
        const tick = this.lastTicks.get(sym);
        if (tick) this.broadcast(tick);
      }
      this.dirtySymbols.clear();
    }, MarketHub.FLUSH_INTERVAL_MS);
  }

  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      if (request.method === 'POST') {
        const payload = await request.json().catch(() => null);
        if (payload) this.broadcast(payload);
        return new Response('ok');
      }
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.handleClient(server);
    this.ensureUpstream();

    return new Response(null, { status: 101, webSocket: client });
  }

  handleClient(ws) {
    ws.accept();
    this.clients.add(ws);

    // Send the latest known snapshot so the UI isn't empty on connect.
    for (const tick of this.lastTicks.values()) {
      try { ws.send(JSON.stringify(tick)); } catch { /* ignore */ }
    }

    ws.addEventListener('close', () => this.clients.delete(ws));
    ws.addEventListener('error', () => this.clients.delete(ws));
  }

  ensureUpstream() {
    if (this.upstream && this.upstream.readyState === WebSocket.OPEN) return;

    if (this.activeSource === 'coinbase') {
      this.connectCoinbase();
    } else {
      this.connectKraken();
    }
  }

  connectCoinbase() {
    try {
      const ws = new WebSocket(COINBASE_WS);
      this.upstream = ws;

      ws.addEventListener('open', () => {
        this.upstreamReconnectAttempts = 0;
        ws.send(JSON.stringify({
          type: 'subscribe',
          product_ids: COINBASE_PRODUCTS,
          channel: 'ticker',
        }));
      });

      ws.addEventListener('message', (event) => {
        this.handleCoinbaseMessage(event.data);
      });

      ws.addEventListener('close', () => this.scheduleReconnect());
      ws.addEventListener('error', () => {
        // If Coinbase fails repeatedly, fall back to Kraken.
        if (this.upstreamReconnectAttempts >= 3) {
          this.activeSource = 'kraken';
        }
        this.scheduleReconnect();
      });
    } catch {
      this.activeSource = 'kraken';
      this.scheduleReconnect();
    }
  }

  connectKraken() {
    try {
      const ws = new WebSocket(KRAKEN_WS);
      this.upstream = ws;

      ws.addEventListener('open', () => {
        this.upstreamReconnectAttempts = 0;
        ws.send(JSON.stringify({
          event: 'subscribe',
          pair: KRAKEN_PAIRS,
          subscription: { name: 'ticker' },
        }));
      });

      ws.addEventListener('message', (event) => {
        this.handleKrakenMessage(event.data);
      });

      ws.addEventListener('close', () => this.scheduleReconnect());
      ws.addEventListener('error', () => this.scheduleReconnect());
    } catch {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    this.upstreamReconnectAttempts += 1;
    const delay = Math.min(30000, 1000 * 2 ** this.upstreamReconnectAttempts);
    setTimeout(() => this.ensureUpstream(), delay);
  }

  // Coinbase sends ticker updates: { type:'ticker', product_id, price, open_24h, volume_24h, ... }
  handleCoinbaseMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Coinbase Advanced Trade wraps events in { channel, events: [...] }
    const events = msg.events || (msg.type === 'ticker' ? [msg] : []);
    for (const ev of events) {
      const tickers = ev.tickers || (ev.type === 'ticker' ? [ev] : []);
      for (const ticker of tickers) {
        const symbol = COINBASE_TO_SYMBOL[ticker.product_id];
        if (!symbol || !ticker.price) continue;

        const price = parseFloat(ticker.price);
        const nowSec = Math.floor(Date.now() / 1000);
        const bucketSec = nowSec - (nowSec % 60);

        let candle = this.partialCandles.get(symbol);
        if (!candle || this.bucketStart.get(symbol) !== bucketSec) {
          // New 1-minute bucket.
          candle = { time: bucketSec, open: price, high: price, low: price, close: price, volume: 0 };
          this.bucketStart.set(symbol, bucketSec);
        } else {
          candle.high = Math.max(candle.high, price);
          candle.low = Math.min(candle.low, price);
          candle.close = price;
          candle.volume += parseFloat(ticker.last_size || ticker.size || 0);
        }
        this.partialCandles.set(symbol, candle);

        const tick = {
          type: 'kline',
          symbol,
          interval: '1m',
          isFinal: false,
          candle: { ...candle },
        };
        this.lastTicks.set(symbol, tick);
        this.scheduleFlush(symbol);
      }
    }
  }

  // Kraken sends ticker as [channelID, { b:[bid,...], a:[ask,...], c:[last,vol], ... }, 'ticker', 'XBT/USD']
  handleKrakenMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!Array.isArray(msg) || msg.length < 4) return;
    const data = msg[1];
    const pairName = msg[3];
    const symbol = KRAKEN_TO_SYMBOL[pairName];
    if (!symbol || !data || !data.c) return;

    const price = parseFloat(data.c[0]);
    // Kraken ticker: v[0] = today's volume, t[0] = today's trade count (use vol increment per tick)
    const vol = parseFloat(data.v?.[0] || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    const bucketSec = nowSec - (nowSec % 60);

    let candle = this.partialCandles.get(symbol);
    if (!candle || this.bucketStart.get(symbol) !== bucketSec) {
      candle = { time: bucketSec, open: price, high: price, low: price, close: price, volume: vol };
      this.bucketStart.set(symbol, bucketSec);
    } else {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      if (vol > candle.volume) candle.volume = vol;
    }
    this.partialCandles.set(symbol, candle);

    const tick = {
      type: 'kline',
      symbol,
      interval: '1m',
      isFinal: false,
      candle: { ...candle },
    };
    this.lastTicks.set(symbol, tick);
    this.scheduleFlush(symbol);
  }

  broadcast(tick) {
    const msg = JSON.stringify(tick);
    for (const ws of this.clients) {
      try {
        ws.send(msg);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}
