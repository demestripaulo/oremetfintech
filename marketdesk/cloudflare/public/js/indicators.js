function badgeClass(status) {
  if (status === 'COMPRA' || status === 'BUY') return 'buy';
  if (status === 'VENDA' || status === 'SELL') return 'sell';
  return 'neutral';
}

function badgeLabel(status) {
  if (status === 'COMPRA' || status === 'BUY') return t('buy');
  if (status === 'VENDA' || status === 'SELL') return t('sell');
  return t('neutral');
}

function renderIndicators(data) {
  const container = document.getElementById('indicators-container');
  if (!data) {
    container.innerHTML = `<p class="indicator-explain">${t('loadingIndicators')}</p>`;
    return;
  }
  const { rsi, macd, bollinger, atr, volume, pattern } = data;

  container.innerHTML = `
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip(t('rsiName'), 'RSI')}</div>
        <div class="indicator-explain">${rsi.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${rsi.value}</div>
        <span class="badge ${badgeClass(rsi.status)}">${badgeLabel(rsi.status)}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip(t('macdName'), 'MACD')}</div>
        <div class="indicator-explain">${macd.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${macd.histogram}</div>
        <span class="badge ${badgeClass(macd.status)}">${badgeLabel(macd.status)}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip(t('bollingerName'), 'Bollinger')}</div>
        <div class="indicator-explain">${bollinger.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${bollinger.lower} / ${bollinger.upper}</div>
        <span class="badge ${badgeClass(bollinger.status)}">${badgeLabel(bollinger.status)}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip(t('volumeName'), 'Support')}</div>
        <div class="indicator-explain">${volume.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${volume.ratio}x</div>
        <span class="badge ${badgeClass(volume.status)}">${badgeLabel(volume.status)}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip(t('atrName'), 'ATR')}</div>
        <div class="indicator-explain">${atr.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${atr.value}</div>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${t('patternDetected')}</div>
        <div class="indicator-explain">${pattern.explanation}</div>
      </div>
      <div style="text-align:right">
        <span class="badge ${badgeClass(pattern.bias === 'bullish' ? 'BUY' : pattern.bias === 'bearish' ? 'SELL' : 'NEUTRAL')}">${pattern.name}</span>
      </div>
    </div>
  `;

  renderSupportResistance(data.pivots, data.price);
  renderConnectors(data);
  renderMarketStructure(data.marketStructure);
}

function renderSupportResistance(pivots, price) {
  const container = document.getElementById('sr-container');
  if (!pivots) { container.innerHTML = ''; return; }
  const levels = [
    { label: 'R2', value: pivots.r2 },
    { label: 'R1', value: pivots.r1 },
    { label: 'Pivot', value: pivots.pivot },
    { label: 'S1', value: pivots.s1 },
    { label: 'S2', value: pivots.s2 },
  ];
  let criticalIdx = 0, minDist = Infinity;
  levels.forEach((l, i) => { const d = Math.abs(l.value - price); if (d < minDist) { minDist = d; criticalIdx = i; } });

  container.innerHTML = `
    <table class="sr-table">
      <thead><tr>
        <th>${withTooltip(t('srLevel'), 'Pivot Points')}</th>
        <th>${t('srPrice')}</th>
        <th>${t('srDistance')}</th>
      </tr></thead>
      <tbody>
        ${levels.map((l, i) => {
          const distPct = (((l.value - price) / price) * 100).toFixed(2);
          return `<tr class="${i === criticalIdx ? 'critical' : ''}">
            <td>${withTooltip(l.label, l.label)}</td>
            <td class="mono">${l.value.toFixed(2)}</td>
            <td class="mono">${distPct}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderMarketStructure(ms) {
  const container = document.getElementById('ms-container');
  if (!container) return;
  if (!ms) { container.innerHTML = `<p class="panel-message">${t('loadingIndicators')}</p>`; return; }

  const scorePct = ((ms.score + 5) / 10) * 100; // map -5..5 to 0..100%
  const fillColor = ms.bias === 'bullish' ? 'var(--bull)' : ms.bias === 'bearish' ? 'var(--bear)' : 'var(--neutral)';
  const scoreLabel = ms.bias === 'bullish' ? t('bullish') : ms.bias === 'bearish' ? t('bearish') : t('neutral');
  const sign = ms.score > 0 ? '+' : '';

  const breakdownHtml = ms.scoreBreakdown.length
    ? ms.scoreBreakdown.map((b) => `
        <div class="ms-breakdown-item ${b.value > 0 ? 'positive' : b.value < 0 ? 'negative' : ''}">
          <span>${b.label}</span>
        </div>`).join('')
    : '';

  container.innerHTML = `
    <div class="ms-score-bar">
      <div>
        <div class="ms-score-value ${ms.bias}">${sign}${ms.score}</div>
        <div class="ms-score-label">/ 5</div>
      </div>
      <div style="flex:1">
        <div class="ms-score-track">
          <div class="ms-score-fill" style="width:${scorePct}%;background:${fillColor}"></div>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:3px">${scoreLabel}</div>
      </div>
    </div>
    ${ms.primaryEvent ? `<div class="ms-primary-event ${ms.bias}">${ms.primaryEvent.message.replace(/\n/g, '<br>')}</div>` : ''}
    ${breakdownHtml ? `<div class="ms-breakdown">${breakdownHtml}</div>` : ''}
  `;
}

function renderConnectors(data) {
  const container = document.getElementById('connectors-container');
  const { rsi, macd, pivots, price, pattern } = data;
  const bearActive = rsi.value > 70 || macd.status === 'VENDA' || macd.status === 'SELL';
  const bullActive = rsi.value < 30 || macd.status === 'COMPRA' || macd.status === 'BUY';
  const nearestResistance = price < pivots.r1 ? pivots.r1 : pivots.r2;
  const nearestSupport = price > pivots.s1 ? pivots.s1 : pivots.s2;

  container.innerHTML = `
    <div class="connector">
      <div class="dot ${bearActive ? 'red' : 'yellow'}"></div>
      <div>
        <div class="title">${t('bearSignal')}</div>
        <div class="body">${bearActive
          ? t('bearActive')(rsi.value, macd.status, pattern.name)
          : t('noBear')}</div>
        <div class="trigger">${t('breakBelow')} ${nearestSupport.toFixed(2)}</div>
      </div>
    </div>
    <div class="connector">
      <div class="dot yellow"></div>
      <div>
        <div class="title">${t('attentionZone')}</div>
        <div class="body">${t('attnBody')(nearestResistance.toFixed(2), nearestSupport.toFixed(2))}</div>
        <div class="trigger">${t('currentPrice')}: ${price.toFixed(2)}</div>
      </div>
    </div>
    <div class="connector">
      <div class="dot ${bullActive ? 'green' : 'yellow'}"></div>
      <div>
        <div class="title">${t('bullEntry')}</div>
        <div class="body">${bullActive
          ? t('bullActive')(rsi.value, macd.status)
          : t('noBull')}</div>
        <div class="trigger">${t('breakAbove')} ${nearestResistance.toFixed(2)}</div>
      </div>
    </div>
  `;
}
