// Durable Object that keeps a single upstream connection to Binance combined
// streams and fans out ticks to every browser client connected to this Worker.

const SYMBOLS = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt'];
const STREAM_URL =
  'wss://stream.binance.com:9443/stream?streams=' +
  SYMBOLS.map((s) => `${s}@kline_1m`).join('/');

export class MarketHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set();
    this.upstream = null;
    this.upstreamReconnectAttempts = 0;
    this.lastTicks = new Map();
  }

  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
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

    // Send the latest known snapshot immediately so the UI isn't empty.
    for (const tick of this.lastTicks.values()) {
      ws.send(JSON.stringify(tick));
    }

    ws.addEventListener('close', () => this.clients.delete(ws));
    ws.addEventListener('error', () => this.clients.delete(ws));
    ws.addEventListener('message', () => {
      // Clients are passive subscribers; ignore inbound messages besides pings.
    });
  }

  ensureUpstream() {
    if (this.upstream && this.upstream.readyState === WebSocket.OPEN) return;

    try {
      const upstream = new WebSocket(STREAM_URL);
      this.upstream = upstream;

      upstream.addEventListener('open', () => {
        this.upstreamReconnectAttempts = 0;
      });

      upstream.addEventListener('message', (event) => {
        this.handleUpstreamMessage(event.data);
      });

      upstream.addEventListener('close', () => this.scheduleReconnect());
      upstream.addEventListener('error', () => this.scheduleReconnect());
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    this.upstreamReconnectAttempts += 1;
    const delay = Math.min(30000, 1000 * 2 ** this.upstreamReconnectAttempts);
    setTimeout(() => this.ensureUpstream(), delay);
  }

  handleUpstreamMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
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
    this.lastTicks.set(tick.symbol, tick);
    this.broadcast(tick);
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
