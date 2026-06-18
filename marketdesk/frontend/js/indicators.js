function badgeClass(status) {
  if (status === 'COMPRA') return 'buy';
  if (status === 'VENDA') return 'sell';
  return 'neutral';
}

function renderIndicators(data) {
  const container = document.getElementById('indicators-container');
  if (!data) {
    container.innerHTML = '<p class="indicator-explain">Carregando indicadores...</p>';
    return;
  }
  const { rsi, macd, bollinger, atr, volume, pattern } = data;

  container.innerHTML = `
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip('RSI (14)', 'RSI')}</div>
        <div class="indicator-explain">${rsi.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${rsi.value}</div>
        <span class="badge ${badgeClass(rsi.status)}">${rsi.status}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip('MACD (12,26,9)', 'MACD')}</div>
        <div class="indicator-explain">${macd.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${macd.histogram}</div>
        <span class="badge ${badgeClass(macd.status)}">${macd.status}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip('Bollinger Bands', 'Bollinger')}</div>
        <div class="indicator-explain">${bollinger.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${bollinger.lower} / ${bollinger.upper}</div>
        <span class="badge ${badgeClass(bollinger.status)}">${bollinger.status}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip('Volume (vs média 20)', 'Suporte')}</div>
        <div class="indicator-explain">${volume.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${volume.ratio}x</div>
        <span class="badge ${badgeClass(volume.status)}">${volume.status}</span>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">${withTooltip('ATR (14)', 'ATR')}</div>
        <div class="indicator-explain">${atr.explanation}</div>
      </div>
      <div style="text-align:right">
        <div class="indicator-value">${atr.value}</div>
      </div>
    </div>
    <div class="indicator-row">
      <div>
        <div class="indicator-name">Padrão detectado</div>
        <div class="indicator-explain">${pattern.explanation}</div>
      </div>
      <div style="text-align:right">
        <span class="badge ${badgeClass(pattern.bias === 'bullish' ? 'COMPRA' : pattern.bias === 'bearish' ? 'VENDA' : 'NEUTRO')}">${pattern.name}</span>
      </div>
    </div>
  `;

  renderSupportResistance(data.pivots, data.price);
  renderConnectors(data);
}

function renderSupportResistance(pivots, price) {
  const container = document.getElementById('sr-container');
  if (!pivots) {
    container.innerHTML = '';
    return;
  }
  const levels = [
    { label: 'R2', value: pivots.r2 },
    { label: 'R1', value: pivots.r1 },
    { label: 'Pivot', value: pivots.pivot },
    { label: 'S1', value: pivots.s1 },
    { label: 'S2', value: pivots.s2 },
  ];
  let criticalIdx = 0;
  let minDist = Infinity;
  levels.forEach((l, i) => {
    const dist = Math.abs(l.value - price);
    if (dist < minDist) { minDist = dist; criticalIdx = i; }
  });

  container.innerHTML = `
    <table class="sr-table">
      <thead><tr><th>${withTooltip('Nível', 'Pivot Points')}</th><th>Preço</th><th>Distância</th></tr></thead>
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

function renderConnectors(data) {
  const container = document.getElementById('connectors-container');
  const { rsi, macd, pivots, price, pattern } = data;

  const bearActive = rsi.value > 70 || macd.status === 'VENDA';
  const bullActive = rsi.value < 30 || macd.status === 'COMPRA';
  const nearestResistance = price < pivots.r1 ? pivots.r1 : pivots.r2;
  const nearestSupport = price > pivots.s1 ? pivots.s1 : pivots.s2;

  container.innerHTML = `
    <div class="connector">
      <div class="dot ${bearActive ? 'red' : 'yellow'}"></div>
      <div>
        <div class="title">Sinal Bear</div>
        <div class="body">${bearActive
          ? `RSI em ${rsi.value} e MACD em ${macd.status.toLowerCase()} sugerem pressão vendedora. O padrão de candle mais recente foi "${pattern.name}".`
          : 'Nenhuma condição bearish forte ativa no momento.'}</div>
        <div class="trigger">Gatilho: rompimento abaixo de ${nearestSupport.toFixed(2)}</div>
      </div>
    </div>
    <div class="connector">
      <div class="dot yellow"></div>
      <div>
        <div class="title">Zona de Atenção</div>
        <div class="body">Nível crítico a monitorar: ${nearestResistance.toFixed(2)} (resistência) e ${nearestSupport.toFixed(2)} (suporte). Rompimento confirmado com volume acima da média valida a continuação; rejeição com pavio longo nega o movimento.</div>
        <div class="trigger">Preço atual: ${price.toFixed(2)}</div>
      </div>
    </div>
    <div class="connector">
      <div class="dot ${bullActive ? 'green' : 'yellow'}"></div>
      <div>
        <div class="title">Critério de Entrada Bull</div>
        <div class="body">${bullActive
          ? `RSI em ${rsi.value} e MACD em ${macd.status.toLowerCase()} favorecem viés comprador. Confirmação adicional viria de volume acima da média.`
          : 'Condições de alta ainda não satisfeitas: aguardar RSI < 30 ou cruzamento positivo do MACD com volume crescente.'}</div>
        <div class="trigger">Gatilho: rompimento acima de ${nearestResistance.toFixed(2)}</div>
      </div>
    </div>
  `;
}
