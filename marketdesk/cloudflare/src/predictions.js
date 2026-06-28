import {
  calculateATR,
  calculateRSI,
  calculateMACD,
  volumeRatio,
  detectCandlePattern,
  calculatePivotPoints,
  round,
} from './analysis.js';

// Computes a probable price range for the given interval:
//   '15min' — next 15-minute candle (Kalshi 15-min markets)
//   '1h'    — next 60-minute candle (Kalshi hourly markets)
//   'daily' — closing price at 5 PM ET today (Kalshi daily BTC markets)
export function predictRange(candles, interval, lang = 'en') {
  const currentPrice = candles[candles.length - 1].close;
  const atr = calculateATR(candles, 14);

  // How many 1-min ATR units to project forward.
  let volatilityMultiplier;
  if (interval === '15min') {
    volatilityMultiplier = 0.3;
  } else if (interval === '1h') {
    volatilityMultiplier = 1.0;
  } else {
    // 'daily': number of hours remaining until 5 PM ET, floored at 1.
    // We inflate ATR proportionally and apply an uncertainty decay so the
    // range grows sub-linearly (sqrt scaling) over the remaining day.
    const hoursLeft = hoursUntil5pmET();
    volatilityMultiplier = Math.sqrt(Math.max(1, hoursLeft)) * 1.5;
  }

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
    if (level > rangeLow && level < currentPrice) {
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
  const confidence = calculateConfluence(rsi, macd, volRatio, pattern, interval);

  let bias = 'neutral';
  if (momentumScore > 0.15) bias = 'bullish';
  else if (momentumScore < -0.15) bias = 'bearish';

  const explanation = buildExplanation({
    interval, bias, rsi, macd, volRatio, pattern, atr, confidence, lang,
  });

  return {
    interval,
    range_low: round(rangeLow, 2),
    range_high: round(rangeHigh, 2),
    midpoint: round(midpoint, 2),
    bias,
    confidence: round(confidence, 0),
    explanation,
    kalshiTarget: interval === 'daily' ? kalshi5pmLabel() : null,
  };
}

// Returns hours remaining until 5:00 PM US Eastern Time (ET = UTC-5 / UTC-4 DST).
function hoursUntil5pmET() {
  const now = new Date();
  // Approximate ET offset: -5 in EST, -4 in EDT. We use -5 conservatively.
  const etOffsetHours = -5;
  const nowET = new Date(now.getTime() + etOffsetHours * 3600 * 1000);
  const target = new Date(nowET);
  target.setUTCHours(17, 0, 0, 0); // 5 PM ET expressed as UTC-5
  if (nowET >= target) {
    // Past 5 PM — project to tomorrow's 5 PM.
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return (target - nowET) / 3600000;
}

// Human-readable Kalshi target label: "5PM ET — Tue, Jun 17"
function kalshi5pmLabel() {
  const now = new Date();
  const etOffsetHours = -5;
  const nowET = new Date(now.getTime() + etOffsetHours * 3600 * 1000);
  const target = new Date(nowET);
  target.setUTCHours(17, 0, 0, 0);
  if (nowET >= target) target.setUTCDate(target.getUTCDate() + 1);
  return target.toUTCString().replace(' GMT', ' ET').slice(0, -3);
}

function calculateConfluence(rsi, macd, volRatio, pattern, interval) {
  let score = 50;
  if (rsi > 65 || rsi < 35) score += 10;
  if (macd.direction !== 'neutral') score += 10;
  if (Math.abs(macd.histogram) > 0) score += Math.min(10, Math.abs(macd.histogram) * 2);
  if (volRatio > 1.2) score += 10;
  else if (volRatio < 0.7) score -= 5;
  if (
    (pattern.bias === 'bullish' && macd.direction === 'bullish') ||
    (pattern.bias === 'bearish' && macd.direction === 'bearish')
  ) {
    score += 10;
  }
  // Daily forecasts carry inherently lower confidence due to longer horizon.
  if (interval === 'daily') score = Math.max(20, score - 15);
  return Math.max(20, Math.min(95, score));
}

function buildExplanation({ interval, bias, rsi, macd, volRatio, pattern, atr, confidence, lang }) {
  const isEn = lang !== 'pt';

  if (isEn) {
    const horizonLabel = interval === '15min' ? 'the next 15 minutes' : interval === '1h' ? 'the next hour' : "today's close at 5 PM ET (Kalshi Daily)";
    const biasLabel = bias === 'bullish' ? 'bullish bias' : bias === 'bearish' ? 'bearish bias' : 'neutral/sideways bias';
    const rsiText = rsi > 70
      ? `RSI at ${round(rsi, 1)} indicates overbought conditions, which may limit further gains.`
      : rsi < 30
      ? `RSI at ${round(rsi, 1)} indicates oversold conditions, which may favor a recovery.`
      : `RSI at ${round(rsi, 1)} is in neutral territory with no extreme readings.`;
    const macdText = `MACD is trending ${macd.direction === 'bullish' ? 'upward' : macd.direction === 'bearish' ? 'downward' : 'sideways'}, reinforcing current momentum.`;
    const volText = volRatio > 1.2
      ? 'Current volume is above average, confirming the strength of the move.'
      : volRatio < 0.7
      ? 'Volume is below average, suggesting low conviction in the current move.'
      : 'Volume is within the recent average range.';
    const patternText = `The latest detected candlestick pattern is "${pattern.name}".`;
    const atrText = `Recent average volatility (ATR) is ${round(atr, 2)}, used as the basis for the projected range.`;
    const dailyNote = interval === 'daily'
      ? ' For the Kalshi daily market, the projected range expands with the time remaining until 5 PM ET using square-root scaling of intraday volatility.'
      : '';
    return `For ${horizonLabel}, the model signals a ${biasLabel} with ${round(confidence, 0)}% confidence. ${rsiText} ${macdText} ${volText} ${patternText} ${atrText}${dailyNote} This is an educational estimate based on historical technical analysis, not a guarantee of future price movement.`;
  }

  // Portuguese
  const horizonLabel = interval === '15min' ? 'os próximos 15 minutos' : interval === '1h' ? 'a próxima hora' : 'o fechamento de hoje às 17h ET (Kalshi Daily)';
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
  const dailyNote = interval === 'daily'
    ? ' Para o mercado diário do Kalshi, o range de projeção cresce com o tempo restante até as 17h ET usando escala raiz-quadrada da volatilidade intra-diária.'
    : '';
  return `Para ${horizonLabel}, o modelo aponta um ${biasLabel} com confiança de ${round(confidence, 0)}%. ${rsiText} ${macdText} ${volText} ${patternText} ${atrText}${dailyNote} Esta é uma estimativa educacional baseada em análise técnica histórica, não uma garantia de movimento futuro.`;
}
