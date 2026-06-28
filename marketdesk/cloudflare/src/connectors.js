// External data connectors: Fear & Greed, CoinGecko sentiment, Glassnode
// on-chain metrics, and a lightweight RSS aggregator for crypto news.
// All functions degrade gracefully when an API key or upstream is missing.

const cache = new Map();

function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data);
  return fn().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

export async function getFearGreedIndex() {
  return cached('fng', 60 * 60 * 1000, async () => {
    try {
      const res = await fetch('https://api.alternative.me/fng/');
      if (!res.ok) throw new Error(`Alternative.me HTTP ${res.status}`);
      const data = await res.json();
      const entry = data.data && data.data[0];
      if (!entry) throw new Error('Resposta vazia');
      return {
        value: parseInt(entry.value, 10),
        classification: entry.value_classification,
        timestamp: parseInt(entry.timestamp, 10) * 1000,
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

export async function getCoinGeckoSentiment(coinId = 'bitcoin') {
  return cached(`cg-sentiment:${coinId}`, 60 * 60 * 1000, async () => {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=false`
      );
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();
      return {
        developerScore: data.developer_score,
        communityScore: data.community_score,
        sentimentUp: data.sentiment_votes_up_percentage,
        sentimentDown: data.sentiment_votes_down_percentage,
        marketCapChange24h: data.market_data?.market_cap_change_percentage_24h,
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

export async function getGlassnodeMetric(metricPath, asset, apiKey) {
  if (!apiKey) return { error: 'GLASSNODE_API_KEY não configurada' };
  return cached(`glassnode:${metricPath}:${asset}`, 30 * 60 * 1000, async () => {
    try {
      const url = `https://api.glassnode.com/v1/metrics/${metricPath}?a=${asset}&api_key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Glassnode HTTP ${res.status}`);
      const data = await res.json();
      const last = data[data.length - 1];
      return { metric: metricPath, value: last?.v, timestamp: last?.t ? last.t * 1000 : null };
    } catch (err) {
      return { error: err.message };
    }
  });
}

export async function getOnChainPanel(apiKey) {
  const [activeAddresses, exchangeNetflow, sopr] = await Promise.all([
    getGlassnodeMetric('addresses/active_count', 'BTC', apiKey),
    getGlassnodeMetric('transactions/transfers_volume_exchanges_net', 'BTC', apiKey),
    getGlassnodeMetric('indicators/sopr', 'BTC', apiKey),
  ]);
  return { activeAddresses, exchangeNetflow, sopr };
}

export async function getMessariMetrics(assetKey = 'bitcoin') {
  return cached(`messari:${assetKey}`, 30 * 60 * 1000, async () => {
    try {
      const res = await fetch(`https://data.messari.io/api/v1/assets/${assetKey}/metrics`);
      if (!res.ok) throw new Error(`Messari HTTP ${res.status}`);
      const data = await res.json();
      const m = data.data?.market_data || {};
      return {
        realVolume: m.real_volume_last_24_hours,
        nvtRatio: data.data?.metrics?.nvt?.nvt_ratio,
        sharpeRatio: data.data?.metrics?.risk_metrics?.sharpe_ratio_180d,
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

// ---------- Kalshi 15-min crypto targets ----------
// Kalshi's market-data GET endpoints are public (no auth). We read the OPEN
// markets for the BTC/ETH short-horizon price series and surface their strikes
// ("targets") plus the implied probability from the order book mid.
//
// NOTE: Kalshi may block Cloudflare egress IPs (like Binance does) and the
// series tickers below can change on their side. Everything degrades to
// { error } so the panel never breaks. If discovery returns nothing, update
// KALSHI_SERIES after checking GET /series?category=Crypto.
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

const KALSHI_SERIES = {
  BTC: 'KXBTC',
  ETH: 'KXETH',
};

// Normalize a raw Kalshi market object into a compact target descriptor.
function normalizeKalshiMarket(m) {
  if (!m) return null;
  const yesBid = typeof m.yes_bid === 'number' ? m.yes_bid : null;
  const yesAsk = typeof m.yes_ask === 'number' ? m.yes_ask : null;
  let impliedProb = null;
  if (yesBid != null && yesAsk != null) impliedProb = (yesBid + yesAsk) / 2 / 100;
  else if (typeof m.last_price === 'number') impliedProb = m.last_price / 100;
  return {
    ticker: m.ticker || null,
    title: m.yes_sub_title || m.subtitle || m.title || m.ticker || '',
    floorStrike: typeof m.floor_strike === 'number' ? m.floor_strike : null,
    capStrike: typeof m.cap_strike === 'number' ? m.cap_strike : null,
    strikeType: m.strike_type || null,
    impliedProb,            // 0..1, or null
    closeTime: m.close_time || m.expiration_time || null,
  };
}

export async function getKalshiTargets(asset = 'BTC') {
  const key = String(asset).toUpperCase();
  const series = KALSHI_SERIES[key];
  if (!series) return { error: `Ativo não suportado pela Kalshi: ${asset}` };

  return cached(`kalshi:${key}`, 30 * 1000, async () => {
    try {
      const url = `${KALSHI_API}/markets?series_ticker=${series}&status=open&limit=200`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
      const data = await res.json();
      const markets = Array.isArray(data.markets) ? data.markets : [];

      // Keep only markets whose window closes within the next ~16 minutes —
      // i.e. the live 15-minute window.
      const now = Date.now();
      const horizon = now + 16 * 60 * 1000;
      const current = markets.filter((m) => {
        const ct = m.close_time || m.expiration_time;
        if (!ct) return false;
        const t = new Date(ct).getTime();
        return t >= now && t <= horizon;
      });

      const pool = current.length > 0 ? current : markets;
      const targets = pool
        .map(normalizeKalshiMarket)
        .filter((t) => t && (t.floorStrike != null || t.capStrike != null))
        .sort((a, b) => (a.floorStrike ?? a.capStrike ?? 0) - (b.floorStrike ?? b.capStrike ?? 0));

      if (targets.length === 0) throw new Error('Nenhum mercado 15min aberto');

      const closeTime = targets[0].closeTime;
      return { asset: key, series, closeTime, count: targets.length, targets, source: 'Kalshi' };
    } catch (err) {
      return { error: err.message };
    }
  });
}

export async function getExternalIntelligence(env) {
  const [fearGreed, sentiment, onChain] = await Promise.all([
    getFearGreedIndex(),
    getCoinGeckoSentiment('bitcoin'),
    getOnChainPanel(env.GLASSNODE_API_KEY),
  ]);
  return { fearGreed, sentiment, onChain };
}

// ---------- Crypto news aggregation via public RSS feeds ----------
const NEWS_FEEDS = [
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://cryptonews.com/news/feed/',
];

const KEYWORDS = ['bitcoin', 'btc', 'crypto', 'market', 'ethereum', 'eth'];

const BULLISH_WORDS = ['surge', 'rally', 'soar', 'gain', 'bull', 'breakout', 'all-time high', 'jump', 'recover'];
const BEARISH_WORDS = ['crash', 'plunge', 'drop', 'bear', 'sell-off', 'selloff', 'decline', 'tumble', 'fear', 'liquidat'];

function parseRssItems(xml, sourceUrl) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const description = extractTag(block, 'description');
    if (title) {
      items.push({ title: stripCdata(title), link: stripCdata(link), pubDate, description: stripCdata(description), source: sourceUrl });
    }
  }
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(block);
  return m ? m[1].trim() : '';
}

function stripCdata(str) {
  return (str || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').replace(/<[^>]+>/g, '').trim();
}

function classifySentiment(text) {
  const lower = text.toLowerCase();
  const bull = BULLISH_WORDS.some((w) => lower.includes(w));
  const bear = BEARISH_WORDS.some((w) => lower.includes(w));
  if (bull && !bear) return 'BULLISH';
  if (bear && !bull) return 'BEARISH';
  return 'NEUTRO';
}

export async function getMarketNews(assetFilter) {
  return cached(`news:${assetFilter || 'all'}`, 5 * 60 * 1000, async () => {
    const results = await Promise.allSettled(
      NEWS_FEEDS.map(async (url) => {
        const res = await fetch(url, { headers: { 'User-Agent': 'MarketDesk/1.0' } });
        if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
        const xml = await res.text();
        return parseRssItems(xml, url);
      })
    );

    let items = [];
    for (const r of results) {
      if (r.status === 'fulfilled') items = items.concat(r.value);
    }

    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    items = items.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const matchesKeyword = KEYWORDS.some((k) => text.includes(k));
      const matchesAsset = !assetFilter || text.includes(assetFilter.toLowerCase());
      const time = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
      return matchesKeyword && matchesAsset && time >= twoHoursAgo;
    });

    items = items.slice(0, 15).map((item) => ({
      ...item,
      sentiment: classifySentiment(`${item.title} ${item.description}`),
    }));

    return items;
  });
}
