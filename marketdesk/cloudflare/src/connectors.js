// External data connectors: Danelfin (correlated stocks), Fear & Greed,
// CoinGecko sentiment, Glassnode on-chain, Messari fundamentals, and a
// lightweight RSS aggregator for crypto news. All functions degrade
// gracefully (return null / empty) when an API key or upstream is missing.

const cache = new Map();

function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data);
  return fn().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

export const BTC_CORRELATED_STOCKS = ['MSTR', 'COIN', 'MARA', 'RIOT', 'IBIT'];

export async function getDanelfinScore(ticker, apiKey) {
  if (!apiKey) return { ticker, error: 'DANELFIN_API_KEY não configurada' };
  return cached(`danelfin:${ticker}`, 60 * 60 * 1000, async () => {
    try {
      const res = await fetch(`https://apirest.danelfin.com/ranking?ticker=${ticker}`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!res.ok) throw new Error(`Danelfin HTTP ${res.status}`);
      const data = await res.json();
      return {
        ticker,
        aiScore: data.ai_score,
        technical: data.technical,
        fundamental: data.fundamental,
        sentiment: data.sentiment,
        lowRisk: data.low_risk,
        signal: data.signal,
      };
    } catch (err) {
      return { ticker, error: err.message };
    }
  });
}

export async function getDanelfinPanel(apiKey) {
  const scores = await Promise.all(BTC_CORRELATED_STOCKS.map((t) => getDanelfinScore(t, apiKey)));
  return { scores, note: 'Dados de ações correlatas via Danelfin AI. Scores são para ações, não para BTC diretamente.' };
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
