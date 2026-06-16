const GLOSSARY = {
  RSI: 'Índice de Força Relativa: mede a velocidade e magnitude dos movimentos de preço, variando de 0 a 100. Acima de 70 sugere sobrecompra; abaixo de 30, sobrevenda.',
  MACD: 'Convergência/Divergência de Médias Móveis: compara uma média rápida (12) e uma lenta (26) para identificar mudanças de momentum.',
  Bollinger: 'Bandas de Bollinger: envelope de volatilidade construído a partir de uma média móvel e desvio padrão. Bandas estreitas indicam baixa volatilidade.',
  ATR: 'Average True Range: mede a volatilidade média recente em valor absoluto de preço, útil para estimar ranges futuros.',
  EMA: 'Média Móvel Exponencial: dá mais peso aos preços recentes, reagindo mais rápido que uma média simples.',
  SMA: 'Média Móvel Simple: média aritmética dos preços de fechamento em um período definido.',
  'Pivot Points': 'Níveis calculados a partir da máxima, mínima e fechamento do período anterior, usados para estimar suporte e resistência.',
  Suporte: 'Nível de preço onde historicamente a pressão de compra supera a de venda, dificultando novas quedas.',
  Resistência: 'Nível de preço onde historicamente a pressão de venda supera a de compra, dificultando novas altas.',
  Hammer: 'Padrão de candle com sombra inferior longa, indicando rejeição de preços baixos — possível reversão de alta.',
  Doji: 'Candle com abertura e fechamento quase idênticos, refletindo indecisão do mercado.',
  'Bullish Engulfing': 'Vela de alta que engole completamente a vela anterior de baixa — forte sinal comprador.',
  'Bearish Engulfing': 'Vela de baixa que engole completamente a vela anterior de alta — forte sinal vendedor.',
  'Morning Star': 'Padrão de três velas que sinaliza reversão de baixa para alta.',
  'Evening Star': 'Padrão de três velas que sinaliza reversão de alta para baixa.',
};

function renderGlossary() {
  const list = document.getElementById('glossary-list');
  list.innerHTML = Object.entries(GLOSSARY)
    .map(([term, def]) => `<div class="glossary-term"><b>${term}:</b> ${def}</div>`)
    .join('');
}

function withTooltip(label, term) {
  const def = GLOSSARY[term] || '';
  return `<span class="tooltip">${label}<span class="tip">${def}</span></span>`;
}

document.addEventListener('DOMContentLoaded', renderGlossary);
