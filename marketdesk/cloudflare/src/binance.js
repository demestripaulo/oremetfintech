// Binance REST client with a 5s minimum cache (via in-memory map) and
// basic rate-limit protection. Falls back Binance → Binance.US → CoinGecko
// for klines, and Binance → Binance.US → CoinGecko for 24h tickers.

const BINANCE_REST = 'https://api.binance.com/api/v3';
const BINANCE_US_REST = 'https://api.binance.us/api/v3';
const COINGECKO_REST = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_MS = 5000;
const FETCH_TIMEOUT_MS = 8000; // abort slow upstream calls before CF's 30s wall

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MarketDesk/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }
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

const COIN_ID_MAP = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
};

export async function fetchKlines(symbol, interval = '1m', limit = 200) {
  const binanceInterval = INTERVAL_MAP[interval] || interval;
  const cacheKey = `klines:${symbol}:${binanceInterval}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Try Binance → Binance.US → CoinGecko, never throw to the caller.
  for (const baseUrl of [BINANCE_REST, BINANCE_US_REST]) {
    try {
      const candles = await fetchBinanceKlines(baseUrl, symbol, binanceInterval, limit);
      if (candles.length > 0) {
        cacheSet(cacheKey, candles);
        return candles;
      }
    } catch {
      // try next source
    }
  }

  try {
    const candles = await fetchKlinesCoinGecko(symbol, limit);
    if (candles.length > 0) {
      cacheSet(cacheKey, candles);
      return candles;
    }
  } catch {
    // all sources exhausted
  }

  throw new Error('Dados de candles indisponíveis (Binance, Binance.US e CoinGecko falharam)');
}

async function fetchBinanceKlines(baseUrl, symbol, interval, limit) {
  const url = `${baseUrl}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`${baseUrl.includes('binance.us') ? 'Binance.US' : 'Binance'} HTTP ${res.status}`);
  const raw = await res.json();
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchKlinesCoinGecko(symbol, limit) {
  const coinId = COIN_ID_MAP[symbol.toUpperCase()] || 'bitcoin';
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

  // Try Binance → Binance.US → CoinGecko simple price fallback.
  for (const baseUrl of [BINANCE_REST, BINANCE_US_REST]) {
    try {
      const data = await fetchBinanceTicker(baseUrl, symbol);
      const out = {
        symbol: data.symbol,
        price: parseFloat(data.lastPrice),
        changePercent: parseFloat(data.priceChangePercent),
        volume: parseFloat(data.volume),
      };
      cacheSet(cacheKey, out);
      return out;
    } catch {
      // try next source
    }
  }

  // CoinGecko simple price fallback for tickers
  try {
    const coinId = COIN_ID_MAP[symbol.toUpperCase()] || 'bitcoin';
    const url = `${COINGECKO_REST}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
    const res = await throttledFetch(url);
    if (!res.ok) throw new Error(`CoinGecko ticker HTTP ${res.status}`);
    const data = await res.json();
    const coin = data[coinId];
    const out = {
      symbol,
      price: coin.usd,
      changePercent: coin.usd_24h_change ?? 0,
      volume: coin.usd_24h_vol ?? 0,
    };
    cacheSet(cacheKey, out);
    return out;
  } catch {
    // return a safe stub so the rest of the app doesn't crash
    return { symbol, price: 0, changePercent: 0, volume: 0 };
  }
}

async function fetchBinanceTicker(baseUrl, symbol) {
  const url = `${baseUrl}/ticker/24hr?symbol=${symbol.toUpperCase()}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`${baseUrl.includes('binance.us') ? 'Binance.US' : 'Binance'} HTTP ${res.status}`);
  return res.json();
}

export const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
