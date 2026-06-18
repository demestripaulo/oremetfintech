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
  // S/R levels
  R2: 'Segunda Resistência: nível acima do qual o preço raramente sobe sem força compradora muito intensa. Zona de atenção para possíveis reversões.',
  R1: 'Primeira Resistência: barreira imediata acima do preço atual. Se rompida com volume, pode acelerar a alta.',
  Pivot: 'Ponto Pivô: nível central calculado como (máxima + mínima + fechamento) ÷ 3 do período anterior. Define o "equilíbrio" do mercado — acima = bullish, abaixo = bearish.',
  S1: 'Primeiro Suporte: piso imediato abaixo do preço atual. Zona onde compradores costumam aparecer para defender a queda.',
  S2: 'Segundo Suporte: suporte mais distante. Perder este nível indica pressão vendedora significativa.',
  // Bias
  BULLISH: 'Viés de Alta: os indicadores técnicos apontam para maior probabilidade de o preço subir no horizonte analisado. Não é garantia — é uma leitura probabilística do momentum atual.',
  BEARISH: 'Viés de Baixa: os indicadores apontam para maior probabilidade de queda. O mercado apresenta mais pressão vendedora do que compradora no momento.',
  NEUTRAL: 'Sem tendência definida: o mercado não apresenta força direcional clara. Movimentos laterais são mais prováveis; aguardar confirmação antes de tomar posição.',
  // Chart lines
  'EMA 9': 'Linha Dourada — EMA 9: Média Móvel Exponencial dos últimos 9 períodos. Reflete o momentum de curtíssimo prazo. Quando o preço está acima dela, tendência imediata é de alta.',
  'EMA 21': 'Linha Azul — EMA 21: Média Móvel Exponencial de 21 períodos. Referência de tendência de curto prazo. Cruzamento com EMA 9 sinaliza mudança de momentum.',
  'SMA 50': 'Linha Creme — SMA 50: Média Móvel Simples de 50 períodos. Tendência de médio prazo. Preço acima = território bull; abaixo = território bear.',
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
