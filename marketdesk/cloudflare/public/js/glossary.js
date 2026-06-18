const GLOSSARY = {
  en: {
    RSI: 'Relative Strength Index: measures the speed and magnitude of price movements, ranging from 0 to 100. Above 70 suggests overbought; below 30, oversold.',
    MACD: 'Moving Average Convergence/Divergence: compares a fast (12) and slow (26) moving average to identify momentum changes.',
    Bollinger: 'Bollinger Bands: volatility envelope built from a moving average and standard deviation. Narrow bands indicate low volatility.',
    ATR: 'Average True Range: measures average recent volatility in absolute price value, useful for estimating future ranges.',
    EMA: 'Exponential Moving Average: gives more weight to recent prices, reacting faster than a simple moving average.',
    SMA: 'Simple Moving Average: arithmetic mean of closing prices over a defined period.',
    'Pivot Points': 'Levels calculated from the prior period\'s high, low, and close, used to estimate support and resistance.',
    Support: 'Price level where buying pressure historically exceeds selling pressure, slowing further declines.',
    Resistance: 'Price level where selling pressure historically exceeds buying pressure, slowing further advances.',
    Hammer: 'Candle pattern with a long lower shadow, indicating rejection of lower prices — possible bullish reversal.',
    Doji: 'Candle with open and close nearly identical, reflecting market indecision.',
    'Bullish Engulfing': 'Bullish candle that completely engulfs the prior bearish candle — strong buy signal.',
    'Bearish Engulfing': 'Bearish candle that completely engulfs the prior bullish candle — strong sell signal.',
    'Morning Star': 'Three-candle pattern signaling reversal from downtrend to uptrend.',
    'Evening Star': 'Three-candle pattern signaling reversal from uptrend to downtrend.',
    R2: 'Second Resistance: level above which price rarely rises without intense buying pressure. Watch for potential reversals.',
    R1: 'First Resistance: immediate barrier above current price. If broken with volume, can accelerate the rally.',
    Pivot: 'Pivot Point: central level calculated as (high + low + close) ÷ 3 of the prior period. Above = bullish bias; below = bearish bias.',
    S1: 'First Support: immediate floor below current price. Zone where buyers typically appear to defend the decline.',
    S2: 'Second Support: deeper support level. Losing this level signals significant selling pressure.',
    BULLISH: 'Bullish bias: technical indicators point to a higher probability of price rising. This is a probabilistic reading of current momentum, not a guarantee.',
    BEARISH: 'Bearish bias: indicators point to a higher probability of price falling. More selling pressure than buying pressure is currently detected.',
    NEUTRAL: 'No defined trend: the market shows no clear directional momentum. Sideways movement is more likely; wait for confirmation before taking a position.',
    'EMA 9': 'Gold line — EMA 9: 9-period Exponential Moving Average. Reflects ultra-short-term momentum. Price above = immediate bullish bias.',
    'EMA 21': 'Blue line — EMA 21: 21-period Exponential Moving Average. Short-term trend reference. Crossover with EMA 9 signals momentum shift.',
    'SMA 50': 'Cream line — SMA 50: 50-period Simple Moving Average. Medium-term trend. Price above = bull territory; below = bear territory.',
  },
  pt: {
    RSI: 'Índice de Força Relativa: mede a velocidade e magnitude dos movimentos de preço, variando de 0 a 100. Acima de 70 sugere sobrecompra; abaixo de 30, sobrevenda.',
    MACD: 'Convergência/Divergência de Médias Móveis: compara uma média rápida (12) e uma lenta (26) para identificar mudanças de momentum.',
    Bollinger: 'Bandas de Bollinger: envelope de volatilidade construído a partir de uma média móvel e desvio padrão. Bandas estreitas indicam baixa volatilidade.',
    ATR: 'Average True Range: mede a volatilidade média recente em valor absoluto de preço, útil para estimar ranges futuros.',
    EMA: 'Média Móvel Exponencial: dá mais peso aos preços recentes, reagindo mais rápido que uma média simples.',
    SMA: 'Média Móvel Simples: média aritmética dos preços de fechamento em um período definido.',
    'Pivot Points': 'Níveis calculados a partir da máxima, mínima e fechamento do período anterior, usados para estimar suporte e resistência.',
    Support: 'Nível de preço onde historicamente a pressão de compra supera a de venda, dificultando novas quedas.',
    Resistance: 'Nível de preço onde historicamente a pressão de venda supera a de compra, dificultando novas altas.',
    Hammer: 'Padrão de candle com sombra inferior longa, indicando rejeição de preços baixos — possível reversão de alta.',
    Doji: 'Candle com abertura e fechamento quase idênticos, refletindo indecisão do mercado.',
    'Bullish Engulfing': 'Vela de alta que engole completamente a vela anterior de baixa — forte sinal comprador.',
    'Bearish Engulfing': 'Vela de baixa que engole completamente a vela anterior de alta — forte sinal vendedor.',
    'Morning Star': 'Padrão de três velas que sinaliza reversão de baixa para alta.',
    'Evening Star': 'Padrão de três velas que sinaliza reversão de alta para baixa.',
    R2: 'Segunda Resistência: nível acima do qual o preço raramente sobe sem força compradora muito intensa. Zona de atenção para possíveis reversões.',
    R1: 'Primeira Resistência: barreira imediata acima do preço atual. Se rompida com volume, pode acelerar a alta.',
    Pivot: 'Ponto Pivô: nível central calculado como (máxima + mínima + fechamento) ÷ 3 do período anterior. Acima = bullish; abaixo = bearish.',
    S1: 'Primeiro Suporte: piso imediato abaixo do preço atual. Zona onde compradores costumam aparecer para defender a queda.',
    S2: 'Segundo Suporte: suporte mais distante. Perder este nível indica pressão vendedora significativa.',
    BULLISH: 'Viés de Alta: os indicadores técnicos apontam para maior probabilidade de o preço subir no horizonte analisado. Não é garantia — é uma leitura probabilística do momentum atual.',
    BEARISH: 'Viés de Baixa: os indicadores apontam para maior probabilidade de queda. O mercado apresenta mais pressão vendedora do que compradora no momento.',
    NEUTRAL: 'Sem tendência definida: o mercado não apresenta força direcional clara. Movimentos laterais são mais prováveis; aguardar confirmação antes de tomar posição.',
    'EMA 9': 'Linha Dourada — EMA 9: Média Móvel Exponencial dos últimos 9 períodos. Reflete o momentum de curtíssimo prazo.',
    'EMA 21': 'Linha Azul — EMA 21: Média Móvel Exponencial de 21 períodos. Referência de tendência de curto prazo.',
    'SMA 50': 'Linha Creme — SMA 50: Média Móvel Simples de 50 períodos. Tendência de médio prazo.',
  },
};

function glossaryFor(lang) {
  return GLOSSARY[lang] || GLOSSARY.en;
}

function renderGlossary() {
  const list = document.getElementById('glossary-list');
  if (!list) return;
  const g = glossaryFor(window.LANG || 'en');
  list.innerHTML = Object.entries(g)
    .map(([term, def]) => `<div class="glossary-term"><b>${term}:</b> ${def}</div>`)
    .join('');
}

function withTooltip(label, term) {
  const g = glossaryFor(window.LANG || 'en');
  const def = g[term] || '';
  return `<span class="tooltip">${label}<span class="tip">${def}</span></span>`;
}

document.addEventListener('DOMContentLoaded', renderGlossary);
