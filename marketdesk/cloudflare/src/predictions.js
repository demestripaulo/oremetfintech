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

// ---------- Model ⇄ market probability crossing ----------
// Standard normal CDF via the Abramowitz-Stegun erf approximation.
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// Treat the forecast as ~Normal(mean=midpoint, sigma=half the projected band).
// The band is heuristic, not a true CI, so this is an APPROXIMATION used only to
// compare against the market's implied probability — never a guarantee.
function modelSigma(prediction) {
  const base = (prediction.range_high - prediction.range_low) / 2;
  const s = base > 0 ? base : Math.max(1e-6, Math.abs(prediction.midpoint) * 0.001);
  // A neutral bias means the model found no directional edge — its band alone
  // understates that uncertainty, which was overstating modelProb near 50/50
  // markets (the bucket where most calibration error showed up). Widen sigma
  // for neutral calls so modelProb pulls closer to 50%.
  return prediction.bias === 'neutral' ? s * 1.6 : s;
}

// ---------- Isotonic-style recalibration (pool-adjacent-violators) ----------
// Fits a monotonic step function mapping raw modelProb -> observed frequency,
// from weighted (x, y, weight) points (typically reliability-bucket midpoints).
// This is an in-sample diagnostic, not a leave-one-out estimate — treat any
// resulting Brier improvement as illustrative upside, not a validated result.
export function pavFit(points) {
  const sorted = [...points].filter((p) => p.w > 0).sort((a, b) => a.x - b.x);
  const stack = [];
  for (const p of sorted) {
    let block = { sumY: p.y * p.w, sumW: p.w, xMin: p.x, xMax: p.x };
    stack.push(block);
    while (stack.length > 1) {
      const b2 = stack[stack.length - 1];
      const b1 = stack[stack.length - 2];
      if (b1.sumY / b1.sumW <= b2.sumY / b2.sumW) break;
      stack.pop(); stack.pop();
      stack.push({ sumY: b1.sumY + b2.sumY, sumW: b1.sumW + b2.sumW, xMin: b1.xMin, xMax: b2.xMax });
    }
  }
  return stack.map((b) => ({ xMin: b.xMin, xMax: b.xMax, value: b.sumY / b.sumW }));
}

export function pavApply(fit, x) {
  if (!fit || fit.length === 0) return x;
  for (const b of fit) if (x <= b.xMax) return b.value;
  return fit[fit.length - 1].value;
}

// Model-implied probability that the settlement satisfies a Kalshi target.
export function modelProbForTarget(prediction, target) {
  const m = prediction.midpoint;
  const s = modelSigma(prediction);
  const probAbove = (k) => 1 - normalCdf((k - m) / s);
  const type = target.strikeType || '';
  if (type === 'between' && target.floorStrike != null && target.capStrike != null) {
    return normalCdf((target.capStrike - m) / s) - normalCdf((target.floorStrike - m) / s);
  }
  if (type.startsWith('less') && (target.capStrike ?? target.floorStrike) != null) {
    return 1 - probAbove(target.capStrike ?? target.floorStrike);
  }
  if (target.floorStrike != null) return probAbove(target.floorStrike); // greater_or_equal default
  return null;
}

// Combine model probability with the market's implied probability.
// edge > 0 ⇒ model thinks YES is underpriced by the market.
export function combineProb(modelP, marketP, edgeThreshold = 0.08) {
  if (modelP == null) return { signal: 'NO_MODEL', agree: null, edge: null };
  if (marketP == null) return { signal: 'MODEL_ONLY', agree: null, edge: null, modelP };
  const edge = modelP - marketP;
  const agree = (modelP >= 0.5) === (marketP >= 0.5);
  let signal;
  if (!agree) signal = 'DIVERGE';
  else signal = modelP >= 0.5 ? 'AGREE_YES' : 'AGREE_NO';
  let value = 'fair';
  if (edge >= edgeThreshold) value = 'yes_value';
  else if (edge <= -edgeThreshold) value = 'no_value';
  return { signal, agree, edge: round(edge, 3), value, modelP: round(modelP, 3), marketP: round(marketP, 3) };
}

// Enrich Kalshi targets in place with model probability + crossing verdict.
export function crossKalshiTargets(prediction, targets) {
  if (!prediction || !Array.isArray(targets)) return targets;
  for (const t of targets) {
    const modelP = modelProbForTarget(prediction, t);
    t.modelProb = modelP == null ? null : round(modelP, 3);
    t.cross = combineProb(modelP, t.impliedProb);
  }
  return targets;
}

// ---------- Phase 1: paper-trading P&L simulator (no real money) ----------
// Replays resolved calibration samples through a fee-aware strategy:
// trade only when the model edge clears a threshold; buy the side the model
// favors at the market price; settle vs the binary outcome. Fees use Kalshi's
// quadratic shape (~feeRate · p · (1−p) per contract).
export const PAPER_CONFIG = { edgeThreshold: 0.10, feeRate: 0.07, contracts: 1 };

export function simulatePaperTrades(samples, config = PAPER_CONFIG) {
  const cfg = { ...PAPER_CONFIG, ...config };
  const usable = (samples || []).filter((e) =>
    e && e.status === 'resolved' && typeof e.outcome === 'number'
    && typeof e.marketProb === 'number' && typeof e.modelProb === 'number');

  let trades = 0, wins = 0, pnl = 0, fees = 0, staked = 0;
  for (const e of usable) {
    const edge = e.modelProb - e.marketProb;
    if (Math.abs(edge) < cfg.edgeThreshold) continue;       // no clear value → skip
    const side = edge > 0 ? 'yes' : 'no';
    const price = side === 'yes' ? e.marketProb : 1 - e.marketProb;
    if (price <= 0 || price >= 1) continue;                 // no executable price
    const fee = cfg.feeRate * e.marketProb * (1 - e.marketProb) * cfg.contracts;
    const won = side === 'yes' ? e.outcome === 1 : e.outcome === 0;
    const gross = ((won ? 1 : 0) - price) * cfg.contracts;
    pnl += gross - fee;
    fees += fee;
    staked += price * cfg.contracts;
    trades += 1;
    if (won) wins += 1;
  }
  return {
    trades,
    wins,
    skipped: usable.length - trades,
    hitRate: trades ? round(wins / trades, 3) : null,
    pnl: round(pnl, 2),              // net $ per `contracts` units, after fees
    fees: round(fees, 2),
    roi: staked ? round(pnl / staked, 3) : null,  // net P&L / total staked
    config: cfg,
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
