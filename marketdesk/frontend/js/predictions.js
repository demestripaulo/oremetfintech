function biasClass(bias) {
  if (bias === 'bullish') return 'bullish';
  if (bias === 'bearish') return 'bearish';
  return '';
}

function getTimeWindow(interval) {
  const TZ_OFFSET_MS = -4 * 3600 * 1000; // EDT (UTC-4)
  const d = new Date(Date.now() + TZ_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (hh, mm) => {
    const ap = hh >= 12 ? 'PM' : 'AM';
    return `${hh % 12 || 12}:${pad(mm)} ${ap}`;
  };
  if (interval === '15min') {
    const s = Math.floor(m / 15) * 15;
    const e = s + 15;
    return `${fmt(h, s)} → ${fmt(e >= 60 ? h + 1 : h, e >= 60 ? e - 60 : e)} ET`;
  }
  if (interval === '1h') {
    return `→ ${fmt(h + 1, 0)} ET`;
  }
  return '→ 5:00 PM ET';
}

function fmtUpdatedAt() {
  const TZ_OFFSET_MS = -4 * 3600 * 1000;
  const d = new Date(Date.now() + TZ_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const pad = (n) => String(n).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad(m)} ET`;
}

function renderPredictionCard(p, updatedAt) {
  let label;
  if (p.interval === '15min') label = t('next15min');
  else if (p.interval === '1h') label = t('nextHour');
  else label = t('dailyClose');
  const timeWindow = getTimeWindow(p.interval);
  label = `${label} · ${timeWindow}`;

  const biasKey = p.bias.toUpperCase();
  const biasTip = (typeof withTooltip === 'function') ? withTooltip(t(p.bias) || biasKey, biasKey) : biasKey;

  return `
    <div class="card prediction-card ${biasClass(p.bias)}" style="margin-bottom:10px">
      <div class="prediction-header">
        <strong>${label}</strong>
        <span class="badge ${p.bias === 'bullish' ? 'buy' : p.bias === 'bearish' ? 'sell' : 'neutral'}">${biasTip}</span>
      </div>
      <div class="prediction-range mono">${p.range_low.toFixed(2)} — ${p.range_high.toFixed(2)}</div>
      <div class="prediction-updated">↻ ${updatedAt}</div>
      <div class="indicator-explain">${t('midpoint')}: ${p.midpoint.toFixed(2)} · ${t('confidence')}: ${p.confidence}%</div>
      <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width:${p.confidence}%"></div></div>
      <div class="prediction-explain">${p.explanation}</div>
    </div>
  `;
}

function renderPredictions(data) {
  const container = document.getElementById('predictions-container');
  if (!data) {
    container.innerHTML = `<p class="indicator-explain">${t('generatingPredictions')}</p>`;
    return;
  }
  const updatedAt = fmtUpdatedAt();
  const cards = [renderPredictionCard(data.fifteenMin, updatedAt), renderPredictionCard(data.oneHour, updatedAt)];
  if (data.daily) cards.push(renderPredictionCard(data.daily, updatedAt));
  container.innerHTML = cards.join('');
}

const INTERVAL_LABEL = { '15min': '15m', '1h': '1h', daily: '1D' };

function fmtWindow(ms) {
  const TZ_OFFSET_MS = -4 * 3600 * 1000; // EDT (UTC-4)
  const d = new Date(ms + TZ_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const fmtUsdShort = (n) => '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Build display rows: 15-min windows are DIRECTIONAL (to-beat target + UP/DOWN)
// sourced from the calibration log; 1h windows keep the range view.
function buildHistoryRows(log, calib) {
  const rows = [];
  // 15-min directional rows from calibration data.
  for (const e of calib) {
    const toBeat = e.strike;
    let target = '<span class="indicator-explain">—</span>';
    let result = `<span class="hist-pending">${t('histPending')}</span>`;
    if (toBeat != null) target = `<span class="mono">${fmtUsdShort(toBeat)}</span>`;
    if (e.status === 'resolved' && typeof e.outcome === 'number') {
      result = e.outcome === 1
        ? `<span class="hit">▲ ${t('histUp')}</span>`
        : `<span class="miss">▼ ${t('histDown')}</span>`;
    }
    rows.push({ ts: e.windowStart ?? 0, interval: '15m', target, result });
  }
  // 1h range rows from the prediction log.
  for (const e of log) {
    if (e.interval !== '1h') continue;
    const low = e.range_low, high = e.range_low != null ? e.range_high : null;
    const range = `<span class="mono">${low?.toFixed ? low.toFixed(2) : low} — ${high?.toFixed ? high.toFixed(2) : high}</span>`;
    let result = `<span class="hist-pending">${t('histPending')}</span>`;
    if (e.status === 'resolved' && e.resolved_price != null) {
      result = e.hit
        ? `<span class="hit">✓ ${t('histHit')} (${e.resolved_price.toFixed(0)})</span>`
        : `<span class="miss">✗ ${t('histMiss')} (${e.resolved_price.toFixed(0)})</span>`;
    }
    rows.push({ ts: e.windowStart ?? e.generatedAt ?? 0, interval: '1h', target: range, result });
  }
  return rows.sort((a, b) => b.ts - a.ts).slice(0, 40);
}

// Scoreboard: 15m = % UP (directional), 1h = range hit-rate.
function historyScore(log, calib) {
  const parts = [];
  const res15 = calib.filter((e) => e.status === 'resolved' && typeof e.outcome === 'number');
  if (res15.length) {
    const up = res15.filter((e) => e.outcome === 1).length;
    parts.push(`<span class="acc-chip"><b>15m</b> ${Math.round((up / res15.length) * 100)}% ${t('histUp').toLowerCase()} <span class="acc-frac">(${up}/${res15.length})</span></span>`);
  }
  const res1h = log.filter((e) => e.interval === '1h' && e.status === 'resolved');
  if (res1h.length) {
    const hit = res1h.filter((e) => e.hit).length;
    parts.push(`<span class="acc-chip"><b>1h</b> ${Math.round((hit / res1h.length) * 100)}% <span class="acc-frac">(${hit}/${res1h.length})</span></span>`);
  }
  if (!parts.length) return '';
  return `<div class="acc-summary"><span class="acc-label">${t('histAccuracy')}:</span> ${parts.join('')}</div>`;
}

function renderHistory(data) {
  const container = document.getElementById('history-container');
  // Back-compat: accept either { log, calib } or a plain log array.
  const log = Array.isArray(data) ? data : (data?.log || []);
  const calib = (Array.isArray(data) ? [] : (data?.calib || []));

  const rows = buildHistoryRows(log, calib);
  if (rows.length === 0) {
    container.innerHTML = `<p class="indicator-explain">${t('noHistory')}</p>`;
    return;
  }

  const body = rows.map((r) => `<tr>
      <td class="mono">${fmtWindow(r.ts || Date.now())}</td>
      <td>${r.interval}</td>
      <td>${r.target}</td>
      <td>${r.result}</td>
    </tr>`).join('');

  container.innerHTML = `
    ${historyScore(log, calib)}
    <div class="history-scroll">
      <table class="history-table">
        <thead><tr>
          <th>${t('histTime')}</th>
          <th>${t('histInterval')}</th>
          <th>${t('histToBeat')}</th>
          <th>${t('histResult')}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}
