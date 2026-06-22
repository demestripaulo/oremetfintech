// Multi-exchange market-data client for Cloudflare Workers.
//
// IMPORTANT: Binance geo-/cloud-blocks requests coming from Cloudflare's IP
// ranges (frequent HTTP 451/403), which is why charts loaded only
// intermittently. To be reliable from a Worker we try exchanges that do NOT
// block cloud IPs first (Coinbase, Kraken), then fall back to Binance and
// CoinGecko. Every source is wrapped so a failure just advances to the next.
//
// Note: Coinbase/Kraken quote in USD (not USDT) and don't list BNB; for BNB we
// rely on Binance/CoinGecko. USD≈USDT so prices are equivalent for charting.

const BINANCE_REST = 'https://api.binance.com/api/v3';
const BINANCE_US_REST = 'https://api.binance.us/api/v3';
const COINBASE_REST = 'https://api.exchange.coinbase.com';
const KRAKEN_REST = 'https://api.kraken.com/0/public';
const COINGECKO_REST = 'https://api.coingecko.com/api/v3';

const CACHE_TTL_MS = 5000;
const FETCH_TIMEOUT_MS = 6000; // abort slow upstream calls before CF's wall

const memoryCache = new Map();
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 120;

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
      headers: { 'User-Agent': 'MarketDesk/1.0', Accept: 'application/json' },
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

// interval token -> per-exchange representation
const INTERVALS = {
  '1m': { binance: '1m', coinbaseSec: 60, krakenMin: 1 },
  '5m': { binance: '5m', coinbaseSec: 300, krakenMin: 5 },
  '15m': { binance: '15m', coinbaseSec: 900, krakenMin: 15 },
  '1h': { binance: '1h', coinbaseSec: 3600, krakenMin: 60 },
  '4h': { binance: '4h', coinbaseSec: 21600, krakenMin: 240 },
  '1D': { binance: '1d', coinbaseSec: 86400, krakenMin: 1440 },
};

const COINBASE_PRODUCT = {
  BTCUSDT: 'BTC-USD',
  ETHUSDT: 'ETH-USD',
  SOLUSDT: 'SOL-USD',
  XRPUSDT: 'XRP-USD',
};

const KRAKEN_PAIR = {
  BTCUSDT: 'XBTUSD',
  ETHUSDT: 'ETHUSD',
  SOLUSDT: 'SOLUSD',
  XRPUSDT: 'XRPUSD',
};

const COIN_ID_MAP = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
};

// Lightweight Charts needs strictly ascending, unique timestamps (seconds).
function normalizeCandles(candles, limit) {
  const byTime = new Map();
  for (const c of candles) {
    if (Number.isFinite(c.time) && Number.isFinite(c.close)) byTime.set(c.time, c);
  }
  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  return sorted.slice(-limit);
}

export async function fetchKlines(symbol, interval = '1m', limit = 200) {
  const sym = symbol.toUpperCase();
  const spec = INTERVALS[interval] || INTERVALS['1m'];
  const cacheKey = `klines:${sym}:${interval}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached; // already a { candles, source } object

  const sourceEntries = [];
  if (COINBASE_PRODUCT[sym]) sourceEntries.push({ name: 'Coinbase', fn: () => fetchCoinbaseKlines(sym, spec.coinbaseSec, limit) });
  if (KRAKEN_PAIR[sym]) sourceEntries.push({ name: 'Kraken', fn: () => fetchKrakenKlines(sym, spec.krakenMin, limit) });
  sourceEntries.push({ name: 'Binance', fn: () => fetchBinanceKlines(BINANCE_REST, sym, spec.binance, limit) });
  sourceEntries.push({ name: 'Binance.US', fn: () => fetchBinanceKlines(BINANCE_US_REST, sym, spec.binance, limit) });
  sourceEntries.push({ name: 'CoinGecko', fn: () => fetchCoinGeckoKlines(sym, limit) });

  for (const { name, fn } of sourceEntries) {
    try {
      const candles = normalizeCandles(await fn(), limit);
      if (candles.length > 0) {
        const result = { candles, source: name };
        cacheSet(cacheKey, result);
        return result;
      }
    } catch { /* advance to next source */ }
  }

  throw new Error('Candle data unavailable from all sources (Coinbase, Binance, Kraken, CoinGecko)');
}

async function fetchBinanceKlines(baseUrl, symbol, interval, limit) {
  const url = `${baseUrl}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
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

// Coinbase Exchange: rows are [time(s), low, high, open, close, volume], newest first.
async function fetchCoinbaseKlines(symbol, granularitySec, limit) {
  const product = COINBASE_PRODUCT[symbol];
  const url = `${COINBASE_REST}/products/${product}/candles?granularity=${granularitySec}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error('Coinbase resposta inválida');
  return raw.slice(0, limit).map((row) => ({
    time: row[0],
    low: row[1],
    high: row[2],
    open: row[3],
    close: row[4],
    volume: row[5],
  }));
}

// Kraken: result has a dynamic pair key; rows are [time, o, h, l, c, vwap, vol, count].
async function fetchKrakenKlines(symbol, intervalMin, limit) {
  const pair = KRAKEN_PAIR[symbol];
  const url = `${KRAKEN_REST}/OHLC?pair=${pair}&interval=${intervalMin}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const data = await res.json();
  if (data.error && data.error.length) throw new Error(`Kraken: ${data.error.join(',')}`);
  const key = Object.keys(data.result || {}).find((k) => k !== 'last');
  const rows = key ? data.result[key] : [];
  return rows.slice(-limit).map((row) => ({
    time: row[0],
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[6]),
  }));
}

async function fetchCoinGeckoKlines(symbol, limit) {
  const coinId = COIN_ID_MAP[symbol] || 'bitcoin';
  const url = `${COINGECKO_REST}/coins/${coinId}/ohlc?vs_currency=usd&days=1`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const raw = await res.json();
  return raw.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: 0,
  }));
}

export async function fetch24hTicker(symbol) {
  const sym = symbol.toUpperCase();
  const cacheKey = `ticker:${sym}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const sources = [];
  if (COINBASE_PRODUCT[sym]) sources.push(() => fetchCoinbaseTicker(sym));
  sources.push(() => fetchBinanceTicker(BINANCE_REST, sym));
  sources.push(() => fetchBinanceTicker(BINANCE_US_REST, sym));
  sources.push(() => fetchCoinGeckoTicker(sym));

  for (const source of sources) {
    try {
      const out = await source();
      if (out && Number.isFinite(out.price) && out.price > 0) {
        cacheSet(cacheKey, out);
        return out;
      }
    } catch {
      // advance to next source
    }
  }

  // Never throw: return a safe stub so /api/tickers stays valid JSON.
  return { symbol: sym, price: 0, changePercent: 0, volume: 0 };
}

async function fetchBinanceTicker(baseUrl, symbol) {
  const url = `${baseUrl}/ticker/24hr?symbol=${symbol}`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const data = await res.json();
  return {
    symbol,
    price: parseFloat(data.lastPrice),
    changePercent: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.volume),
  };
}

async function fetchCoinbaseTicker(symbol) {
  const product = COINBASE_PRODUCT[symbol];
  const url = `${COINBASE_REST}/products/${product}/stats`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = await res.json();
  const open = parseFloat(data.open);
  const last = parseFloat(data.last);
  return {
    symbol,
    price: last,
    changePercent: open ? ((last - open) / open) * 100 : 0,
    volume: parseFloat(data.volume),
  };
}

async function fetchCoinGeckoTicker(symbol) {
  const coinId = COIN_ID_MAP[symbol] || 'bitcoin';
  const url = `${COINGECKO_REST}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const coin = data[coinId] || {};
  return {
    symbol,
    price: coin.usd ?? 0,
    changePercent: coin.usd_24h_change ?? 0,
    volume: coin.usd_24h_vol ?? 0,
  };
}

export const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
