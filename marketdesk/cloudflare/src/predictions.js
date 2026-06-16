import {
  calculateATR,
  calculateRSI,
  calculateMACD,
  volumeRatio,
  detectCandlePattern,
  calculatePivotPoints,
  round,
} from './analysis.js';

// Computes a probable price range for the given interval ('15min' | '1h')
// using ATR-based volatility, RSI/MACD momentum, volume confirmation and
// snapping to nearby support/resistance levels.
export function predictRange(candles, interval) {
  const currentPrice = candles[candles.length - 1].close;
  const atr = calculateATR(candles, 14);
  const volatilityMultiplier = interval === '15min' ? 0.3 : 1.0;

  const rsi = calculateRSI(candles, 14);
  const macd = calculateMACD(candles);
  const macdSignal = macd.direction === 'bullish' ? 1 : macd.direction === 'bearish' ? -1 : 0;
  const momentumScore = ((rsi - 50) / 50) * 0.5 + macdSignal * 0.5;

  const volRatio = volumeRatio(candles, 20);
  const volumeBias = volRatio > 1.2 ? momentumScore * 1.3 : momentumScore;

  let midpoint = currentPrice + atr * volatilityMultiplier * volumeBias;
  let rangeLow = midpoint - atr * volatilityMultiplier * 0.8;
  let rangeHigh = midpoint + atr * volatilityMultiplier * 0.8;

  // Snap to nearest support/resistance if inside the projected range.
  const pivots = calculatePivotPoints(candles);
  const levels = [pivots.s2, pivots.s1, pivots.pivot, pivots.r1, pivots.r2];
  for (const level of levels) {
    if (level > rangeLow && level < currentPrice && level > rangeLow) {
      rangeLow = Math.max(rangeLow, level);
    }
    if (level < rangeHigh && level > currentPrice) {
      rangeHigh = Math.min(rangeHigh, level);
    }
  }
  if (rangeHigh <= rangeLow) {
    rangeHigh = rangeLow + atr * 0.1;
  }

  const pattern = detectCandlePattern(candles);
  const confidence = calculateConfluence(rsi, macd, volRatio, pattern);

  let bias = 'neutral';
  if (momentumScore > 0.15) bias = 'bullish';
  else if (momentumScore < -0.15) bias = 'bearish';

  const explanation = buildExplanation({
    interval,
    bias,
    rsi,
    macd,
    volRatio,
    pattern,
    atr,
    confidence,
  });

  return {
    interval,
    range_low: round(rangeLow, 2),
    range_high: round(rangeHigh, 2),
    midpoint: round(midpoint, 2),
    bias,
    confidence: round(confidence, 0),
    explanation,
  };
}

function calculateConfluence(rsi, macd, volRatio, pattern) {
  let score = 50;
  // RSI extremes add conviction
  if (rsi > 65 || rsi < 35) score += 10;
  // MACD direction not neutral adds conviction
  if (macd.direction !== 'neutral') score += 10;
  // Strong histogram magnitude
  if (Math.abs(macd.histogram) > 0) score += Math.min(10, Math.abs(macd.histogram) * 2);
  // Volume confirmation
  if (volRatio > 1.2) score += 10;
  else if (volRatio < 0.7) score -= 5;
  // Pattern alignment with macd direction increases confidence
  if (
    (pattern.bias === 'bullish' && macd.direction === 'bullish') ||
    (pattern.bias === 'bearish' && macd.direction === 'bearish')
  ) {
    score += 10;
  }
  return Math.max(20, Math.min(95, score));
}

function buildExplanation({ interval, bias, rsi, macd, volRatio, pattern, atr, confidence }) {
  const horizonLabel = interval === '15min' ? 'os próximos 15 minutos' : 'a próxima hora';
  const biasLabel = bias === 'bullish' ? 'viés de alta' : bias === 'bearish' ? 'viés de baixa' : 'viés neutro/lateral';
  const rsiText = rsi > 70
    ? `RSI em ${round(rsi, 1)} indica sobrecompra, o que pode limitar novas altas.`
    : rsi < 30
    ? `RSI em ${round(rsi, 1)} indica sobrevenda, o que pode favorecer uma recuperação.`
    : `RSI em ${round(rsi, 1)} está em zona neutra, sem extremos.`;
  const macdText = `O MACD está em direção ${macd.direction === 'bullish' ? 'ascendente' : macd.direction === 'bearish' ? 'descendente' : 'lateral'}, reforçando o momentum atual.`;
  const volText = volRatio > 1.2
    ? 'O volume atual está acima da média, o que confirma a força do movimento.'
    : volRatio < 0.7
    ? 'O volume está abaixo da média, sugerindo baixa convicção no movimento.'
    : 'O volume está dentro da média recente.';
  const patternText = `O último padrão de candlestick identificado foi "${pattern.name}".`;
  const atrText = `A volatilidade média (ATR) recente é de ${round(atr, 2)}, usada como base para o range projetado.`;

  return `Para ${horizonLabel}, o modelo aponta um ${biasLabel} com confiança de ${round(confidence, 0)}%. ${rsiText} ${macdText} ${volText} ${patternText} ${atrText} Esta é uma estimativa educacional baseada em análise técnica histórica, não uma garantia de movimento futuro.`;
}
