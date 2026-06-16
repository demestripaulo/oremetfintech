// TrendSpider webhook bridge backed by KV (Workers have no reliable in-memory
// state across requests/isolates), keeping the last 20 inbound/outbound events
// and the user-configured outbound webhook URL.

const CONFIG_KEY = 'trendspider:config';
const LOG_KEY = 'trendspider:log';
const MAX_LOG = 20;

export async function getTrendspiderConfig(env) {
  const raw = await env.MARKET_KV.get(CONFIG_KEY);
  return raw ? JSON.parse(raw) : { url: null, enabled: false };
}

export async function setTrendspiderConfig(env, { url, enabled }) {
  const current = await getTrendspiderConfig(env);
  const next = {
    url: url !== undefined ? url : current.url,
    enabled: enabled !== undefined ? enabled : current.enabled,
  };
  await env.MARKET_KV.put(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export async function recordEvent(env, direction, payload) {
  const raw = await env.MARKET_KV.get(LOG_KEY);
  const log = raw ? JSON.parse(raw) : [];
  log.unshift({ direction, payload, timestamp: Date.now() });
  while (log.length > MAX_LOG) log.pop();
  await env.MARKET_KV.put(LOG_KEY, JSON.stringify(log));
}

export async function getLog(env) {
  const raw = await env.MARKET_KV.get(LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function sendAlertToTrendspider(env, alert) {
  const config = await getTrendspiderConfig(env);
  if (!config.enabled || !config.url) {
    return { sent: false, reason: 'webhook desabilitado ou URL não configurada' };
  }
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
    });
    await recordEvent(env, 'outbound', alert);
    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

export async function testConnection(env) {
  const config = await getTrendspiderConfig(env);
  if (!config.url) return { ok: false, reason: 'URL não configurada' };
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: 'MarketDesk conexão de teste', timestamp: new Date().toISOString() }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function handleInboundWebhook(env, payload) {
  await recordEvent(env, 'inbound', payload);
  return {
    notification: `TrendSpider: ${payload.message || payload.alert_type} (${payload.symbol || ''} ${payload.timeframe || ''})`,
  };
}
