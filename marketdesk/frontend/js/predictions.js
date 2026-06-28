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

// Per-interval hit rate over resolved entries — the "before/after" scoreboard.
function accuracySummary(log) {
  const stats = {};
  for (const e of log) {
    if (e.status !== 'resolved') continue;
    const s = stats[e.interval] || (stats[e.interval] = { hit: 0, total: 0 });
    s.total += 1;
    if (e.hit) s.hit += 1;
  }
  const parts = Object.entries(stats).map(([interval, s]) => {
    const pct = s.total ? Math.round((s.hit / s.total) * 100) : 0;
    return `<span class="acc-chip"><b>${INTERVAL_LABEL[interval] || interval}</b> ${pct}% <span class="acc-frac">(${s.hit}/${s.total})</span></span>`;
  });
  if (parts.length === 0) return '';
  return `<div class="acc-summary"><span class="acc-label">${t('histAccuracy')}:</span> ${parts.join('')}</div>`;
}

function renderHistory(log) {
  const container = document.getElementById('history-container');
  if (!log || log.length === 0) {
    container.innerHTML = `<p class="indicator-explain">${t('noHistory')}</p>`;
    return;
  }

  // Newest window first.
  const sorted = log.slice().sort((a, b) => (b.windowStart ?? b.generatedAt ?? 0) - (a.windowStart ?? a.generatedAt ?? 0));

  const rows = sorted.slice(0, 40).map((e) => {
    const win = fmtWindow(e.windowStart ?? e.generatedAt ?? Date.now());
    const interval = INTERVAL_LABEL[e.interval] || e.interval || '15min';
    const low = e.range_low, high = e.range_high;
    const range = (low?.toFixed ? low.toFixed(2) : low) + ' — ' + (high?.toFixed ? high.toFixed(2) : high);

    let actual = '<span class="indicator-explain">—</span>';
    let result = `<span class="hist-pending">${t('histPending')}</span>`;
    if (e.status === 'resolved' && e.resolved_price != null) {
      actual = `<span class="mono">${e.resolved_price.toFixed(2)}</span>`;
      result = e.hit
        ? `<span class="hit">✓ ${t('histHit')}</span>`
        : `<span class="miss">✗ ${t('histMiss')}</span>`;
    }
    return `<tr>
      <td class="mono">${win}</td>
      <td>${interval}</td>
      <td class="mono">${range}</td>
      <td>${actual}</td>
      <td>${result}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    ${accuracySummary(log)}
    <div class="history-scroll">
      <table class="history-table">
        <thead><tr>
          <th>${t('histTime')}</th>
          <th>${t('histInterval')}</th>
          <th>${t('histRange')}</th>
          <th>${t('histActual')}</th>
          <th>${t('histResult')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
