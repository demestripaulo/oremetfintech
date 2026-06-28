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

// Genuine 15-minute crypto series (frequency: fifteen_min). The hourly range
// series are KXBTC / KXETH if a longer horizon is ever wanted.
const KALSHI_SERIES = {
  BTC: 'KXBTC15M',
  ETH: 'KXETH15M',
};

// Normalize a raw Kalshi market object into a compact target descriptor.
function normalizeKalshiMarket(m) {
  if (!m) return null;
  const yesBid = typeof m.yes_bid === 'number' ? m.yes_bid : null;
  const yesAsk = typeof m.yes_ask === 'number' ? m.yes_ask : null;
  let impliedProb = null;
  if (yesBid != null && yesAsk != null) impliedProb = (yesBid + yesAsk) / 2 / 100;
  else if (typeof m.last_price === 'number' && m.last_price > 0) impliedProb = m.last_price / 100;
  // Midpoint of a 'between' market, else the single strike — used for centering.
  const floor = typeof m.floor_strike === 'number' ? m.floor_strike : null;
  const cap = typeof m.cap_strike === 'number' ? m.cap_strike : null;
  const mid = floor != null && cap != null ? (floor + cap) / 2 : (floor ?? cap);
  return {
    ticker: m.ticker || null,
    title: m.yes_sub_title || m.subtitle || m.title || m.ticker || '',
    floorStrike: floor,
    capStrike: cap,
    strikeMid: mid,
    strikeType: m.strike_type || null,
    impliedProb,            // 0..1, or null
    volume: typeof m.volume === 'number' ? m.volume : null,
    openTime: m.open_time || null,
    closeTime: m.close_time || m.expiration_time || null,
  };
}

// asset: 'BTC'|'ETH'. refPrice (optional): center the returned ladder on it.
export async function getKalshiTargets(asset = 'BTC', refPrice = null) {
  const key = String(asset).toUpperCase();
  const series = KALSHI_SERIES[key];
  if (!series) return { error: `Ativo não suportado pela Kalshi: ${asset}` };
  const ref = Number(refPrice);
  const hasRef = Number.isFinite(ref) && ref > 0;

  return cached(`kalshi:${key}:${hasRef ? Math.round(ref) : 'all'}`, 30 * 1000, async () => {
    try {
      const url = `${KALSHI_API}/markets?series_ticker=${series}&status=open&limit=1000`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
      const data = await res.json();
      const markets = Array.isArray(data.markets) ? data.markets : [];

      // Keep every open market in the window. 15-min crypto can be directional
      // (up/down, no strike) or strike-based — don't require a strike here.
      const all = markets
        .map(normalizeKalshiMarket)
        .filter((t) => t && t.closeTime);
      if (all.length === 0) throw new Error('Nenhum mercado aberto');

      // Pick the window that closes SOONEST (the shortest-horizon live market).
      const now = Date.now();
      const future = all.filter((t) => new Date(t.closeTime).getTime() > now);
      const pool = future.length > 0 ? future : all;
      let earliest = pool[0].closeTime;
      for (const t of pool) if (new Date(t.closeTime) < new Date(earliest)) earliest = t.closeTime;
      let window = pool.filter((t) => t.closeTime === earliest);

      // Window length in minutes (honest label — KXBTC is hourly, not 15min).
      const open = window.find((t) => t.openTime)?.openTime;
      const windowMinutes = open
        ? Math.round((new Date(earliest).getTime() - new Date(open).getTime()) / 60000)
        : null;

      // If the window is strike-based, center on the reference price; if it's
      // directional (no strikes), just return all markets in the window.
      const hasStrikes = window.some((t) => t.strikeMid != null);
      window.sort((a, b) => (a.strikeMid ?? 0) - (b.strikeMid ?? 0));
      let targets;
      if (hasStrikes && hasRef) {
        const byDist = [...window].sort(
          (a, b) => Math.abs((a.strikeMid ?? 0) - ref) - Math.abs((b.strikeMid ?? 0) - ref)
        ).slice(0, 13);
        const keep = new Set(byDist.map((t) => t.ticker));
        targets = window.filter((t) => keep.has(t.ticker));
      } else {
        targets = window.slice(0, 13);
      }

      // The list endpoint often omits live book prices; enrich the few selected
      // targets with their per-market quote so implied prob populates.
      targets = await enrichKalshiPrices(targets);

      return {
        asset: key,
        series,
        closeTime: earliest,
        windowMinutes,
        totalInWindow: window.length,
        count: targets.length,
        refPrice: hasRef ? ref : null,
        targets,
        source: 'Kalshi',
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

// For targets missing an implied probability, fetch their single-market quote.
// Bounded to 8 parallel lookups to stay cheap (15-min windows have ~1 market).
async function enrichKalshiPrices(targets) {
  const need = targets.filter((t) => t.impliedProb == null && t.ticker).slice(0, 8);
  if (need.length === 0) return targets;
  await Promise.allSettled(need.map(async (t) => {
    try {
      const res = await fetch(`${KALSHI_API}/markets/${t.ticker}`, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return;
      const m = (await res.json())?.market;
      if (!m) return;
      const yesBid = typeof m.yes_bid === 'number' ? m.yes_bid : null;
      const yesAsk = typeof m.yes_ask === 'number' ? m.yes_ask : null;
      if (yesBid != null && yesAsk != null && (yesBid > 0 || yesAsk > 0)) t.impliedProb = (yesBid + yesAsk) / 2 / 100;
      else if (typeof m.last_price === 'number' && m.last_price > 0) t.impliedProb = m.last_price / 100;
      if (t.volume == null && typeof m.volume === 'number') t.volume = m.volume;
    } catch { /* leave as-is */ }
  }));
  return targets;
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
