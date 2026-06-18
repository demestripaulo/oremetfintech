function biasClass(bias) {
  if (bias === 'bullish') return 'bullish';
  if (bias === 'bearish') return 'bearish';
  return '';
}

function renderPredictionCard(p) {
  let label;
  if (p.interval === '15min') label = 'Próximos 15 minutos (Kalshi 15-min)';
  else if (p.interval === '1h') label = 'Próxima hora (Kalshi Hourly)';
  else label = `Fechamento 17h ET (Kalshi Daily)${p.kalshiTarget ? ' — ' + p.kalshiTarget : ''}`;
  const biasKey = p.bias.toUpperCase();
  const biasTip = (typeof withTooltip === 'function') ? withTooltip(biasKey, biasKey) : biasKey;
  return `
    <div class="card prediction-card ${biasClass(p.bias)}" style="margin-bottom:10px">
      <div class="prediction-header">
        <strong>${label}</strong>
        <span class="badge ${p.bias === 'bullish' ? 'buy' : p.bias === 'bearish' ? 'sell' : 'neutral'}">${biasTip}</span>
      </div>
      <div class="prediction-range mono">${p.range_low.toFixed(2)} — ${p.range_high.toFixed(2)}</div>
      <div class="indicator-explain">Ponto médio: ${p.midpoint.toFixed(2)} · Confiança: ${p.confidence}%</div>
      <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width:${p.confidence}%"></div></div>
      <div class="prediction-explain">${p.explanation}</div>
    </div>
  `;
}

function renderPredictions(data) {
  const container = document.getElementById('predictions-container');
  if (!data) {
    container.innerHTML = '<p class="indicator-explain">Gerando previsões...</p>';
    return;
  }
  const cards = [renderPredictionCard(data.fifteenMin), renderPredictionCard(data.oneHour)];
  if (data.daily) cards.push(renderPredictionCard(data.daily));
  container.innerHTML = cards.join('');
}

function renderHistory(log) {
  const container = document.getElementById('history-container');
  if (!log || log.length === 0) {
    container.innerHTML = '<p class="indicator-explain">Sem histórico de análises ainda.</p>';
    return;
  }
  const rows = log.slice().reverse().slice(0, 24).map((entry) => {
    const time = new Date(entry.generated_at || entry.generatedAt).toLocaleTimeString('pt-BR');
    const low = entry.range_low ?? entry.fifteenMin?.range_low;
    const high = entry.range_high ?? entry.fifteenMin?.range_high;
    const resolvedPrice = entry.resolved_price;
    let result = '<span class="indicator-explain">pendente</span>';
    if (resolvedPrice != null) {
      const hit = resolvedPrice >= low && resolvedPrice <= high;
      result = hit
        ? `<span class="hit">acertou (${resolvedPrice.toFixed(2)})</span>`
        : `<span class="miss">errou (${resolvedPrice.toFixed(2)})</span>`;
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
        <thead><tr><th>Horário</th><th>Intervalo</th><th>Range previsto</th><th>Resultado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
