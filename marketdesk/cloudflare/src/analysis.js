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
  const rsi = calculateRSI(candles, 14);
  const macd = calculateMACD(candles);
  const bb = calculateBollinger(candles, 20, 2);
  const atr = calculateATR(candles, 14);
  const volRatio = volumeRatio(candles, 20);
  const pattern = detectCandlePattern(candles);
  const ema9 = ema(candles.map((c) => c.close), 9);
  const ema21 = ema(candles.map((c) => c.close), 21);
  const sma50 = sma(candles.map((c) => c.close), 50);

  const rsiStatus = rsi > 70 ? 'SELL' : rsi < 30 ? 'BUY' : 'NEUTRAL';
  const macdStatus = macd.direction === 'bullish' ? 'BUY' : macd.direction === 'bearish' ? 'SELL' : 'NEUTRAL';
  const bbStatus = price > bb.upper ? 'SELL' : price < bb.lower ? 'BUY' : 'NEUTRAL';
  const volStatus = volRatio > 1.2 ? 'BUY' : volRatio < 0.7 ? 'SELL' : 'NEUTRAL';

  const isEn = lang !== 'pt';

  return {
    price,
    ema9,
    ema21,
    sma50,
    rsi: { value: round(rsi, 2), status: rsiStatus, explanation: isEn
      ? 'RSI measures price movement speed; above 70 suggests overbought, below 30 oversold.'
      : 'RSI mede a velocidade dos movimentos de preço; acima de 70 sugere sobrecompra, abaixo de 30 sobrevenda.' },
    macd: { ...macd, macd: round(macd.macd, 2), signal: round(macd.signal, 2), histogram: round(macd.histogram, 2), status: macdStatus, explanation: isEn
      ? 'MACD compares fast and slow moving averages; positive and rising histogram indicates buying strength.'
      : 'MACD compara médias móveis rápidas e lentas; histograma positivo e crescente indica força compradora.' },
    bollinger: { upper: round(bb.upper, 2), middle: round(bb.middle, 2), lower: round(bb.lower, 2), status: bbStatus, explanation: isEn
      ? 'Bollinger Bands show volatility; price touching the upper/lower band may indicate exhaustion of the move.'
      : 'Bollinger Bands mostram a volatilidade; preço tocando a banda superior/inferior pode indicar exaustão do movimento.' },
    atr: { value: round(atr, 2), explanation: isEn
      ? 'ATR measures average recent volatility in absolute price value, used to estimate future ranges.'
      : 'ATR mede a volatilidade média recente em valor absoluto de preço, usado para estimar ranges futuros.' },
    volume: { ratio: round(volRatio, 2), status: volStatus, explanation: isEn
      ? 'Compares current volume to the 20-candle average; high volume confirms the strength of the move.'
      : 'Compara o volume atual com a média das últimas 20 velas; volume alto confirma a força do movimento.' },
    pattern: { ...pattern, explanation: patternExplanation(pattern.name, isEn) },
    pivots: calculatePivotPoints(candles),
    marketStructure: detectMarketStructure(candles, calculatePivotPoints(candles), atr, lang),
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
