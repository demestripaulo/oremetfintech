// Technical analysis primitives shared by predictions.js and the REST handlers.
// All functions operate on an array of candles: { time, open, high, low, close, volume }

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      prev = values[0];
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function ema(values, period) {
  if (values.length < period) return null;
  const series = emaSeries(values, period);
  return series[series.length - 1];
}

export function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  const closes = candles.map((c) => c.close);
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateMACD(candles, fast = 12, slow = 26, signalPeriod = 9) {
  const closes = candles.map((c) => c.close);
  if (closes.length < slow + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0, direction: 'neutral' };
  }
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = emaSeries(macdLine, signalPeriod);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = macd - signal;
  const prevHistogram =
    macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
  let direction = 'neutral';
  if (histogram > 0 && histogram > prevHistogram) direction = 'bullish';
  else if (histogram < 0 && histogram < prevHistogram) direction = 'bearish';
  return { macd, signal, histogram, direction };
}

export function calculateBollinger(candles, period = 20, mult = 2) {
  const closes = candles.map((c) => c.close);
  if (closes.length < period) {
    const last = closes[closes.length - 1] || 0;
    return { upper: last, middle: last, lower: last };
  }
  const slice = closes.slice(closes.length - period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: middle + mult * stdDev,
    middle,
    lower: middle - mult * stdDev,
  };
}

export function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(trs.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function volumeRatio(candles, period = 20) {
  if (candles.length < period + 1) return 1;
  const recent = candles.slice(candles.length - period - 1, candles.length - 1);
  const avg = recent.reduce((a, c) => a + c.volume, 0) / recent.length;
  const current = candles[candles.length - 1].volume;
  if (avg === 0) return 1;
  return current / avg;
}

export function detectCandlePattern(candles) {
  if (candles.length < 3) return { name: 'Undefined', bias: 'neutral' };
  const c0 = candles[candles.length - 1];
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 3];

  const body = Math.abs(c0.close - c0.open);
  const range = c0.high - c0.low || 1e-9;
  const upperWick = c0.high - Math.max(c0.open, c0.close);
  const lowerWick = Math.min(c0.open, c0.close) - c0.low;

  // Doji
  if (body / range < 0.1) {
    return { name: 'Doji', bias: 'neutral' };
  }
  // Hammer
  if (lowerWick > body * 2 && upperWick < body * 0.5 && c0.close >= c0.open) {
    return { name: 'Hammer', bias: 'bullish' };
  }
  // Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.5 && c0.close <= c0.open) {
    return { name: 'Shooting Star', bias: 'bearish' };
  }
  // Bullish Engulfing
  if (
    c1.close < c1.open &&
    c0.close > c0.open &&
    c0.close > c1.open &&
    c0.open < c1.close
  ) {
    return { name: 'Bullish Engulfing', bias: 'bullish' };
  }
  // Bearish Engulfing
  if (
    c1.close > c1.open &&
    c0.close < c0.open &&
    c0.open > c1.close &&
    c0.close < c1.open
  ) {
    return { name: 'Bearish Engulfing', bias: 'bearish' };
  }
  // Morning Star (simplified 3-candle)
  if (
    c2.close < c2.open &&
    Math.abs(c1.close - c1.open) / (c1.high - c1.low || 1e-9) < 0.3 &&
    c0.close > c0.open &&
    c0.close > (c2.open + c2.close) / 2
  ) {
    return { name: 'Morning Star', bias: 'bullish' };
  }
  // Evening Star
  if (
    c2.close > c2.open &&
    Math.abs(c1.close - c1.open) / (c1.high - c1.low || 1e-9) < 0.3 &&
    c0.close < c0.open &&
    c0.close < (c2.open + c2.close) / 2
  ) {
    return { name: 'Evening Star', bias: 'bearish' };
  }
  return { name: c0.close >= c0.open ? 'Bullish Candle' : 'Bearish Candle', bias: c0.close >= c0.open ? 'bullish' : 'bearish' };
}

export function calculatePivotPoints(candles) {
  // Classic pivot points based on the previous full period (last completed candle's session)
  const last = candles[candles.length - 1];
  const high = Math.max(...candles.slice(-20).map((c) => c.high));
  const low = Math.min(...candles.slice(-20).map((c) => c.low));
  const close = last.close;
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  const r2 = pivot + (high - low);
  const s2 = pivot - (high - low);
  return { pivot, r1, r2, s1, s2 };
}

export function buildIndicatorPanel(candles, lang = 'en') {
  const price = candles[candles.length - 1].close;
  const rsiVal = calculateRSI(candles, 14);
  const macd = calculateMACD(candles);
  const bb = calculateBollinger(candles, 20, 2);
  const atrVal = calculateATR(candles, 14);
  const volRatioVal = volumeRatio(candles, 20);
  const pattern = detectCandlePattern(candles);
  const ema9 = ema(candles.map((c) => c.close), 9);
  const ema21 = ema(candles.map((c) => c.close), 21);
  const sma50 = sma(candles.map((c) => c.close), 50);
  const pivots = calculatePivotPoints(candles);
  const ms = detectMarketStructure(candles, pivots, atrVal, lang);

  const rsiStatus = rsiVal > 70 ? 'SELL' : rsiVal < 30 ? 'BUY' : 'NEUTRAL';
  const macdStatus = macd.direction === 'bullish' ? 'BUY' : macd.direction === 'bearish' ? 'SELL' : 'NEUTRAL';
  const bbStatus = price > bb.upper ? 'SELL' : price < bb.lower ? 'BUY' : 'NEUTRAL';
  const volStatus = volRatioVal > 1.2 ? 'BUY' : volRatioVal < 0.7 ? 'SELL' : 'NEUTRAL';
  const isEn = lang !== 'pt';

  const tradeFilter = calculateTradeFilter(candles, {
    price,
    rsi: { value: round(rsiVal, 2) },
    macd: { ...macd, histogram: round(macd.histogram, 4) },
    atr: { value: round(atrVal, 2) },
    volume: { ratio: round(volRatioVal, 2) },
    pattern,
    pivots,
    marketStructure: ms,
  }, lang);

  return {
    price,
    ema9,
    ema21,
    sma50,
    rsi: { value: round(rsiVal, 2), status: rsiStatus, explanation: isEn
      ? 'RSI measures price movement speed; above 70 suggests overbought, below 30 oversold.'
      : 'RSI mede a velocidade dos movimentos de preço; acima de 70 sugere sobrecompra, abaixo de 30 sobrevenda.' },
    macd: { ...macd, macd: round(macd.macd, 2), signal: round(macd.signal, 2), histogram: round(macd.histogram, 2), status: macdStatus, explanation: isEn
      ? 'MACD compares fast and slow moving averages; positive and rising histogram indicates buying strength.'
      : 'MACD compara médias móveis rápidas e lentas; histograma positivo e crescente indica força compradora.' },
    bollinger: { upper: round(bb.upper, 2), middle: round(bb.middle, 2), lower: round(bb.lower, 2), status: bbStatus, explanation: isEn
      ? 'Bollinger Bands show volatility; price touching the upper/lower band may indicate exhaustion of the move.'
      : 'Bollinger Bands mostram a volatilidade; preço tocando a banda superior/inferior pode indicar exaustão do movimento.' },
    atr: { value: round(atrVal, 2), explanation: isEn
      ? 'ATR measures average recent volatility in absolute price value, used to estimate future ranges.'
      : 'ATR mede a volatilidade média recente em valor absoluto de preço, usado para estimar ranges futuros.' },
    volume: { ratio: round(volRatioVal, 2), status: volStatus, explanation: isEn
      ? 'Compares current volume to the 20-candle average; high volume confirms the strength of the move.'
      : 'Compara o volume atual com a média das últimas 20 velas; volume alto confirma a força do movimento.' },
    pattern: { ...pattern, explanation: patternExplanation(pattern.name, isEn) },
    pivots,
    marketStructure: ms,
    tradeFilter,
  };
}

// ---------------------------------------------------------------------------
// Trade Filter — Kalshi 15-min decision aid
// ---------------------------------------------------------------------------

export const TRADE_FILTER_CONFIG = {
  noTrade: {
    rsiMin: 40, rsiMax: 60,
    candleBodyRatio: 0.35,
    structureMin: -1, structureMax: 1,
    minScore: 5,
  },
  bull: {
    rsiThreshold: 55,
    candleBodyRatio: 0.5,
    structureMin: 2,
    minScore: 4,
  },
  bear: {
    rsiThreshold: 45,
    candleBodyRatio: 0.5,
    structureMax: -2,
    minScore: 4,
  },
};

export function calculateTradeFilter(candles, indicators, lang = 'en') {
  if (!candles || candles.length < 5 || !indicators) {
    return { signal: 'WAIT', label: 'AGUARDAR CONFIRMAÇÃO', reason: 'Dados insuficientes.', noTradeScore: 0, bullScore: 0, bearScore: 0, details: {} };
  }

  const cfg = TRADE_FILTER_CONFIG;
  const isEn = lang !== 'pt';
  const { price, rsi, macd, atr, volume, pivots, marketStructure, pattern } = indicators;

  const rsiVal = rsi.value;
  const atrVal = atr.value;
  const volRatioVal = volume.ratio;
  const msScore = marketStructure?.score ?? 0;
  const msEvents = marketStructure?.events || [];
  const macdHist = macd.histogram;
  const macdDir = macd.direction;

  const lastCandle = candles[candles.length - 1];
  const candleBody = Math.abs(lastCandle.close - lastCandle.open);
  const { pivot, r1, s1 } = pivots;
  const tolerance = atrVal * 0.15;

  // Structural events from detectMarketStructure
  const hasConfirmedBreakout = msEvents.some(e =>
    ['RESISTANCE_BREAK', 'SUPPORT_RECOVERY', 'FALSE_BREAKDOWN'].includes(e.pattern));
  const hasConfirmedRetest = msEvents.some(e =>
    ['RETEST_FROM_ABOVE', 'RETEST_REJECTION'].includes(e.pattern));
  const hasFalseBreakout = msEvents.some(e =>
    ['FALSE_BREAKOUT', 'FALSE_BREAKDOWN'].includes(e.pattern));
  const bullishEvent = msEvents.some(e => e.bias === 'bullish');
  const bearishEvent = msEvents.some(e => e.bias === 'bearish');

  // Higher lows / lower highs
  const W = Math.min(15, candles.length);
  const struct = candles.slice(-W);
  const third = Math.max(1, Math.floor(W / 3));
  const earlyLow  = Math.min(...struct.slice(0, third).map(c => c.low));
  const lateLow   = Math.min(...struct.slice(-third).map(c => c.low));
  const earlyHigh = Math.max(...struct.slice(0, third).map(c => c.high));
  const lateHigh  = Math.max(...struct.slice(-third).map(c => c.high));
  const hasHigherLows = lateLow > earlyLow + tolerance;
  const hasLowerHighs = lateHigh < earlyHigh - tolerance;

  // ---- NO TRADE ----
  const isNeutralRSI       = rsiVal >= cfg.noTrade.rsiMin && rsiVal <= cfg.noTrade.rsiMax;
  const isLowVolume        = volRatioVal < 1.0;
  const isSmallCandle      = atrVal > 0 && candleBody < atrVal * cfg.noTrade.candleBodyRatio;
  const isInsideCentral    = (price > pivot && price < r1) || (price > s1 && price < pivot);
  const isNeutralStructure = msScore >= cfg.noTrade.structureMin && msScore <= cfg.noTrade.structureMax;
  const noMacdConviction   = macdDir === 'neutral';

  const noTradeChecks = [
    isNeutralRSI, isLowVolume, isSmallCandle, isInsideCentral,
    isNeutralStructure, !hasConfirmedBreakout, !hasConfirmedRetest,
  ];
  const noTradeScore = noTradeChecks.filter(Boolean).length;

  // ---- BULL ----
  const rsiRisingFromOversold = rsiVal > 30 && rsiVal <= cfg.bull.rsiThreshold && macdDir === 'bullish';
  const bullishMomentum   = rsiVal > cfg.bull.rsiThreshold || rsiRisingFromOversold;
  const strongGreenCandle = lastCandle.close > lastCandle.open && atrVal > 0 && candleBody >= atrVal * cfg.bull.candleBodyRatio;
  const volumeConfirmation = volRatioVal >= 1.0;
  const bullishStructure  = msScore >= cfg.bull.structureMin || hasHigherLows || bullishEvent;
  const bullishBreakout   = lastCandle.close > r1
    || (hasFalseBreakout && lastCandle.close > pivot)
    || msEvents.some(e => e.pattern === 'RETEST_FROM_ABOVE');
  const macdImproving     = macdDir === 'bullish' || macdHist > 0;

  const bullChecks = [
    bullishMomentum, strongGreenCandle, volumeConfirmation,
    bullishStructure, bullishBreakout, macdImproving,
  ];
  const bullScore = bullChecks.filter(Boolean).length;

  // ---- BEAR ----
  const rsiFallingFromOverbought = rsiVal < 70 && rsiVal >= cfg.bear.rsiThreshold && macdDir === 'bearish';
  const bearishMomentum   = rsiVal < cfg.bear.rsiThreshold || rsiFallingFromOverbought;
  const strongRedCandle   = lastCandle.close < lastCandle.open && atrVal > 0 && candleBody >= atrVal * cfg.bear.candleBodyRatio;
  const bearishStructure  = msScore <= cfg.bear.structureMax || hasLowerHighs || bearishEvent;
  const bearishBreakdown  = lastCandle.close < s1
    || (hasFalseBreakout && lastCandle.close < pivot)
    || msEvents.some(e => e.pattern === 'RETEST_REJECTION');
  const macdWeakening     = macdDir === 'bearish' || macdHist < 0;

  const bearChecks = [
    bearishMomentum, strongRedCandle, volumeConfirmation,
    bearishStructure, bearishBreakdown, macdWeakening,
  ];
  const bearScore = bearChecks.filter(Boolean).length;

  // ---- WAIT ----
  const touchingLevel = atrVal > 0 && (
    Math.abs(price - r1) < tolerance * 2 ||
    Math.abs(price - s1) < tolerance * 2 ||
    Math.abs(price - pivot) < tolerance * 2
  );

  // ---- Signal ----
  let signal, label, reason;

  if (bullScore >= cfg.bull.minScore && bullScore > bearScore) {
    signal = 'FAVORABLE_BULL';
    label = isEn ? 'FAVORABLE BULL' : 'CONDIÇÃO FAVORÁVEL BULL';
    reason = isEn
      ? 'Buyers in control: breakout/retest/recovery with momentum.'
      : 'Compradores demonstram controle: rompimento/reteste/recuperação com momentum.';
  } else if (bearScore >= cfg.bear.minScore && bearScore > bullScore) {
    signal = 'FAVORABLE_BEAR';
    label = isEn ? 'FAVORABLE BEAR' : 'CONDIÇÃO FAVORÁVEL BEAR';
    reason = isEn
      ? 'Sellers in control: rejection/support loss/failed retest.'
      : 'Vendedores demonstram controle: rejeição/perda de suporte/reteste falhado.';
  } else if (noTradeScore >= cfg.noTrade.minScore) {
    signal = 'NO_TRADE';
    label = isEn ? 'DO NOT TRADE' : 'NÃO OPERAR';
    const parts = [];
    if (isNeutralRSI) parts.push(isEn ? `neutral RSI (${rsiVal.toFixed(0)})` : `RSI neutro (${rsiVal.toFixed(0)})`);
    if (isLowVolume)  parts.push(isEn ? 'low volume' : 'volume baixo');
    if (isSmallCandle) parts.push(isEn ? 'small candles' : 'candles pequenos');
    if (isInsideCentral) parts.push(isEn ? 'price in chop zone' : 'preço em zona lateral');
    if (isNeutralStructure) parts.push(isEn ? `weak structure (${msScore})` : `estrutura fraca (${msScore})`);
    reason = parts.slice(0, 3).join(' + ') + '. '
      + (isEn ? 'High noise risk in 15-min Kalshi window.' : 'Alto risco de ruído em janela Kalshi de 15 minutos.');
  } else if (touchingLevel || (bullScore >= 2 && bearScore >= 2)) {
    signal = 'WAIT';
    label = isEn ? 'WAIT FOR CONFIRMATION' : 'AGUARDAR CONFIRMAÇÃO';
    reason = isEn
      ? 'Key level being tested — no confirmed close/retest yet.'
      : 'Nível técnico em teste, mas ainda sem fechamento/reteste confirmado.';
  } else {
    signal = 'NO_TRADE';
    label = isEn ? 'DO NOT TRADE' : 'NÃO OPERAR';
    reason = isEn
      ? 'Insufficient conditions. Wait for a clear setup.'
      : 'Condições insuficientes para operação. Aguardar setup claro.';
  }

  const distToR1Pct = price > 0 ? round((r1 - price) / price * 100, 2) : 0;
  const distToS1Pct = price > 0 ? round((price - s1) / price * 100, 2) : 0;

  return {
    signal,
    label,
    reason,
    noTradeScore,
    bullScore,
    bearScore,
    details: {
      rsi: round(rsiVal, 1),
      volumeRatio: round(volRatioVal, 2),
      candleBodyPct: atrVal > 0 ? Math.round((candleBody / atrVal) * 100) : 0,
      insideCentralZone: isInsideCentral,
      hasBreakout: hasConfirmedBreakout,
      hasRetest: hasConfirmedRetest,
      marketStructureScore: msScore,
      macdHistogram: round(macdHist, 4),
      atr: round(atrVal, 2),
      distToR1Pct,
      distToS1Pct,
    },
  };
}

function patternExplanation(name, isEn) {
  const map = {
    'Doji':             [
      'Market indecision: open and close very close together.',
      'Indecisão do mercado: abertura e fechamento muito próximos.',
    ],
    'Hammer':           [
      'Rejection of low prices with strong recovery — possible bullish reversal signal.',
      'Rejeição de preços baixos com forte recuperação, sinal de possível reversão de alta.',
    ],
    'Shooting Star':    [
      'Rejection of high prices — possible bearish reversal signal.',
      'Rejeição de preços altos, sinal de possível reversão de baixa.',
    ],
    'Bullish Engulfing':[
      'Bullish candle fully engulfs the prior bearish candle — strong buy signal.',
      'Vela de alta que engole completamente a vela anterior de baixa, forte sinal comprador.',
    ],
    'Bearish Engulfing':[
      'Bearish candle fully engulfs the prior bullish candle — strong sell signal.',
      'Vela de baixa que engole completamente a vela anterior de alta, forte sinal vendedor.',
    ],
    'Morning Star':     [
      'Three-candle pattern signaling reversal from downtrend to uptrend.',
      'Padrão de três velas que sinaliza reversão de tendência de baixa para alta.',
    ],
    'Evening Star':     [
      'Three-candle pattern signaling reversal from uptrend to downtrend.',
      'Padrão de três velas que sinaliza reversão de tendência de alta para baixa.',
    ],
    'Bullish Candle':   [
      'Standard bullish candle — no special reversal pattern.',
      'Vela de alta padrão sem configuração especial de reversão.',
    ],
    'Bearish Candle':   [
      'Standard bearish candle — no special reversal pattern.',
      'Vela de baixa padrão sem configuração especial de reversão.',
    ],
  };
  const entry = map[name];
  if (entry) return isEn ? entry[0] : entry[1];
  return isEn ? 'Standard candle — no special reversal pattern.' : 'Vela padrão sem configuração especial de reversão.';
}

// Checks whether price has had a significant interaction with a single S/R level
// in the last LOOKBACK candles.
function checkLevelInteraction(candles, level, tolerance, levelName, isSupport, isEn) {
  const LOOKBACK = Math.min(10, candles.length - 1);
  const lookback = candles.slice(-LOOKBACK - 1);
  const last = lookback[lookback.length - 1];
  const price = last.close;

  const aboveLevel = price > level + tolerance;
  const belowLevel = price < level - tolerance;
  const nearLevel = Math.abs(price - level) <= tolerance * 2;

  let recentBreakDown = false;
  let recentBreakUp = false;
  for (let i = 1; i < lookback.length; i++) {
    const p = lookback[i - 1];
    const c = lookback[i];
    if (!recentBreakDown && p.close > level + tolerance && c.close < level - tolerance) recentBreakDown = true;
    if (!recentBreakUp && p.close < level - tolerance && c.close > level + tolerance) recentBreakUp = true;
  }

  if (isSupport) {
    if (recentBreakDown) {
      if (aboveLevel) {
        return { pattern: 'FALSE_BREAKDOWN', level: levelName, value: level, scoreContrib: 2,
          shortLabel: isEn ? `Recovered ${levelName}` : `Recuperou ${levelName}`,
          bias: 'bullish',
          message: isEn
            ? `${levelName} (${level.toFixed(2)}) was breached but price recovered above. Possible false breakdown — bullish signal.`
            : `${levelName} (${level.toFixed(2)}) foi rompido mas preço recuperou. Possível falso rompimento — sinal altista.` };
      }
      if (nearLevel && belowLevel) {
        return { pattern: 'RETEST_REJECTION', level: levelName, value: level, scoreContrib: -2,
          shortLabel: isEn ? `Retest rejection at ${levelName}` : `Rejeição no reteste de ${levelName}`,
          bias: 'bearish',
          message: isEn
            ? `${levelName} (${level.toFixed(2)}) broken. Price retesting from below and rejecting.\nIf closes back above ${level.toFixed(2)} → false breakdown.`
            : `${levelName} (${level.toFixed(2)}) rompido. Preço retestando por baixo e rejeitando.\nSe fechar acima de ${level.toFixed(2)} → falso rompimento.` };
      }
      return { pattern: 'SUPPORT_BREAK', level: levelName, value: level, scoreContrib: -2,
        shortLabel: isEn ? `Lost ${levelName}` : `Perdeu ${levelName}`,
        bias: 'bearish',
        message: isEn
          ? `${levelName} broken at ${level.toFixed(2)}. Awaiting retest.\nIf rejected below ${level.toFixed(2)} → bearish continuation.\nIf recovers above → possible false breakdown.`
          : `${levelName} rompido em ${level.toFixed(2)}. Aguardando reteste.\nSe rejeitado abaixo de ${level.toFixed(2)} → continuação baixista.\nSe recuperar acima → possível falso rompimento.` };
    }
    if (recentBreakUp && aboveLevel) {
      return { pattern: 'SUPPORT_RECOVERY', level: levelName, value: level, scoreContrib: 2,
        shortLabel: isEn ? `Recovered ${levelName}` : `Recuperou ${levelName}`,
        bias: 'bullish',
        message: isEn
          ? `Price recovered above ${levelName} (${level.toFixed(2)}). Bullish reversal signal.`
          : `Preço recuperou acima de ${levelName} (${level.toFixed(2)}). Sinal de reversão altista.` };
    }
  } else {
    if (recentBreakUp) {
      if (belowLevel) {
        return { pattern: 'FALSE_BREAKOUT', level: levelName, value: level, scoreContrib: -2,
          shortLabel: isEn ? `Failed at ${levelName}` : `Falhou em ${levelName}`,
          bias: 'bearish',
          message: isEn
            ? `${levelName} (${level.toFixed(2)}) was breached but price fell back. Possible false breakout — bearish signal.`
            : `${levelName} (${level.toFixed(2)}) foi rompido mas preço recuou. Possível falso rompimento — sinal baixista.` };
      }
      if (nearLevel && aboveLevel) {
        return { pattern: 'RETEST_FROM_ABOVE', level: levelName, value: level, scoreContrib: 1,
          shortLabel: isEn ? `Retesting ${levelName} as support` : `Retestando ${levelName} como suporte`,
          bias: 'bullish',
          message: isEn
            ? `${levelName} (${level.toFixed(2)}) broken — retesting as support.\nIf holds → continuation higher.\nIf breaks below → possible false breakout.`
            : `${levelName} (${level.toFixed(2)}) rompido — retestando como suporte.\nSe sustentar → continuação altista.\nSe romper abaixo → possível falso rompimento.` };
      }
      return { pattern: 'RESISTANCE_BREAK', level: levelName, value: level, scoreContrib: 2,
        shortLabel: isEn ? `Broke ${levelName}` : `Rompeu ${levelName}`,
        bias: 'bullish',
        message: isEn
          ? `${levelName} broken at ${level.toFixed(2)}. Bullish momentum — watch for continuation or retest as support.`
          : `${levelName} rompido em ${level.toFixed(2)}. Momentum altista — observar continuação ou reteste como suporte.` };
    }
    if (nearLevel && !aboveLevel) {
      const wasRejected = lookback.slice(-5).some((c) => c.high >= level - tolerance && c.close < level - tolerance);
      if (wasRejected) {
        return { pattern: 'RESISTANCE_REJECTION', level: levelName, value: level, scoreContrib: -2,
          shortLabel: isEn ? `Failed at ${levelName}` : `Falhou em ${levelName}`,
          bias: 'bearish',
          message: isEn
            ? `Price tested ${levelName} (${level.toFixed(2)}) but was rejected. Resistance holding.`
            : `Preço testou ${levelName} (${level.toFixed(2)}) mas foi rejeitado. Resistência segurando.` };
      }
    }
  }
  return null;
}

export function detectMarketStructure(candles, pivots, atr, lang = 'en') {
  if (candles.length < 5) {
    const msg = lang !== 'pt' ? 'Insufficient data.' : 'Dados insuficientes.';
    return { score: 0, bias: 'neutral', events: [], scoreBreakdown: [], message: msg, primaryEvent: null };
  }
  const tolerance = atr * 0.15;
  const isEn = lang !== 'pt';
  let score = 0;
  const scoreBreakdown = [];
  const events = [];

  const levels = [
    { name: 'R2', value: pivots.r2, isSupport: false },
    { name: 'R1', value: pivots.r1, isSupport: false },
    { name: 'S1', value: pivots.s1, isSupport: true },
    { name: 'S2', value: pivots.s2, isSupport: true },
  ];
  for (const lvl of levels) {
    const result = checkLevelInteraction(candles, lvl.value, tolerance, lvl.name, lvl.isSupport, isEn);
    if (result) {
      events.push(result);
      if (result.scoreContrib !== 0) {
        score += result.scoreContrib;
        scoreBreakdown.push({ label: `${result.scoreContrib > 0 ? '+' : ''}${result.scoreContrib} ${result.shortLabel}`, value: result.scoreContrib });
      }
    }
  }

  // Volume
  const volRatioVal = volumeRatio(candles, 20);
  if (volRatioVal > 1.2) {
    score += 1;
    scoreBreakdown.push({ label: isEn ? '+1 Rising volume' : '+1 Volume crescente', value: 1 });
  }

  // Ascending lows / descending highs (compare first vs last third of recent candles)
  const W = Math.min(15, candles.length);
  const struct = candles.slice(-W);
  const third = Math.max(1, Math.floor(W / 3));
  const earlyLow = Math.min(...struct.slice(0, third).map((c) => c.low));
  const lateLow = Math.min(...struct.slice(-third).map((c) => c.low));
  const earlyHigh = Math.max(...struct.slice(0, third).map((c) => c.high));
  const lateHigh = Math.max(...struct.slice(-third).map((c) => c.high));

  if (lateLow > earlyLow + tolerance) {
    score += 1;
    scoreBreakdown.push({ label: isEn ? '+1 Ascending lows' : '+1 Fundo ascendente', value: 1 });
  }
  if (lateHigh < earlyHigh - tolerance) {
    score -= 1;
    scoreBreakdown.push({ label: isEn ? '-1 Descending highs' : '-1 Topo descendente', value: -1 });
  }

  score = Math.max(-5, Math.min(5, score));
  const bias = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
  const primaryEvent = events.filter((e) => e.scoreContrib !== 0).sort((a, b) => Math.abs(b.scoreContrib) - Math.abs(a.scoreContrib))[0] || null;
  const message = primaryEvent ? primaryEvent.message
    : (isEn ? 'No clear structural event near key levels.' : 'Sem evento estrutural claro nos níveis-chave.');
  return { score, bias, primaryEvent, events, scoreBreakdown, message };
}

export function round(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
