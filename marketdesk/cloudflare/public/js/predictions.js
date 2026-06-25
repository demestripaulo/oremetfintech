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

function renderHistory(log) {
  const container = document.getElementById('history-container');
  if (!log || log.length === 0) {
    container.innerHTML = `<p class="indicator-explain">${t('noHistory')}</p>`;
    return;
  }
  const rows = log.slice().reverse().slice(0, 24).map((entry) => {
    const time = new Date(entry.generated_at || entry.generatedAt).toLocaleTimeString(window.LANG === 'pt' ? 'pt-BR' : 'en-US');
    const low = entry.range_low ?? entry.fifteenMin?.range_low;
    const high = entry.range_high ?? entry.fifteenMin?.range_high;
    const resolvedPrice = entry.resolved_price;
    let result = `<span class="indicator-explain">${t('histPending')}</span>`;
    if (resolvedPrice != null) {
      const hit = resolvedPrice >= low && resolvedPrice <= high;
      result = hit
        ? `<span class="hit">${t('histHit')} (${resolvedPrice.toFixed(2)})</span>`
        : `<span class="miss">${t('histMiss')} (${resolvedPrice.toFixed(2)})</span>`;
    }
    return `<tr>
      <td>${time}</td>
      <td>${entry.interval || '15min'}</td>
      <td class="mono">${low?.toFixed ? low.toFixed(2) : low} — ${high?.toFixed ? high.toFixed(2) : high}</td>
      <td>${result}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="history-scroll">
      <table class="history-table">
        <thead><tr>
          <th>${t('histTime')}</th>
          <th>${t('histInterval')}</th>
          <th>${t('histRange')}</th>
          <th>${t('histResult')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
