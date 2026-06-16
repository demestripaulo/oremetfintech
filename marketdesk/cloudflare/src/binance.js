// Binance REST client with a 5s minimum cache (via Cloudflare Cache API + in-memory fallback)
// and basic rate-limit protection.

const BINANCE_REST = 'https://api.binance.com/api/v3';
const COINGECKO_REST = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_MS = 5000;

const memoryCache = new Map();
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 120; // ~8 req/s ceiling, well under Binance limits

async function throttledFetch(url) {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
  return fetch(url, { headers: { 'User-Agent': 'MarketDesk/1.0' } });
}

function cacheGet(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

const INTERVAL_MAP = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
};

export async function fetchKlines(symbol, interval = '1m', limit = 200) {
  const binanceInterval = INTERVAL_MAP[interval] || interval;
  const cacheKey = `klines:${symbol}:${binanceInterval}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${BINANCE_REST}/klines?symbol=${symbol.toUpperCase()}&interval=${binanceInterval}&limit=${limit}`;
    const res = await throttledFetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const raw = await res.json();
    const candles = raw.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
    cacheSet(cacheKey, candles);
    return candles;
  } catch (err) {
    return fetchKlinesFallback(symbol, limit);
  }
}

// CoinGecko fallback: lower resolution (daily/hourly OHLC), used only if Binance is unreachable.
async function fetchKlinesFallback(symbol, limit) {
  const coinIdMap = {
    BTCUSDT: 'bitcoin',
    ETHUSDT: 'ethereum',
    SOLUSDT: 'solana',
    BNBUSDT: 'binancecoin',
    XRPUSDT: 'ripple',
  };
  const coinId = coinIdMap[symbol.toUpperCase()] || 'bitcoin';
  const cacheKey = `cg:${coinId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${COINGECKO_REST}/coins/${coinId}/ohlc?vs_currency=usd&days=1`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const raw = await res.json();
  const candles = raw.slice(-limit).map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: 0,
  }));
  cacheSet(cacheKey, candles);
  return candles;
}

export async function fetch24hTicker(symbol) {
  const cacheKey = `ticker:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const url = `${BINANCE_REST}/ticker/24hr?symbol=${symbol.toUpperCase()}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const data = await res.json();
  const out = {
    symbol: data.symbol,
    price: parseFloat(data.lastPrice),
    changePercent: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.volume),
  };
  cacheSet(cacheKey, out);
  return out;
}

export const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
