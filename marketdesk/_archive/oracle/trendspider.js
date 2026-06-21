// In-memory log of inbound/outbound TrendSpider webhook traffic (last 10 each way).
// Kept simple and process-local; restart clears the log by design.

const log = [];
const MAX_LOG = 10;
let outboundWebhookUrl = null;
let outboundEnabled = false;

export function setTrendspiderConfig({ url, enabled }) {
  if (url !== undefined) outboundWebhookUrl = url;
  if (enabled !== undefined) outboundEnabled = enabled;
  return getTrendspiderConfig();
}

export function getTrendspiderConfig() {
  return { url: outboundWebhookUrl, enabled: outboundEnabled };
}

export function recordEvent(direction, payload) {
  log.unshift({ direction, payload, timestamp: Date.now() });
  while (log.length > MAX_LOG * 2) log.pop();
}

export function getLog() {
  return log.slice(0, 20);
}

export async function sendAlertToTrendspider(alert) {
  if (!outboundEnabled || !outboundWebhookUrl) return { sent: false, reason: 'webhook desabilitado ou URL não configurada' };
  try {
    const res = await fetch(outboundWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
    });
    recordEvent('outbound', alert);
    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

export async function testConnection() {
  if (!outboundWebhookUrl) return { ok: false, reason: 'URL não configurada' };
  try {
    const res = await fetch(outboundWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', message: 'MarketDesk conexão de teste', timestamp: new Date().toISOString() }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export function handleInboundWebhook(payload) {
  recordEvent('inbound', payload);
  return {
    notification: `TrendSpider: ${payload.message || payload.alert_type} (${payload.symbol || ''} ${payload.timeframe || ''})`,
  };
}
