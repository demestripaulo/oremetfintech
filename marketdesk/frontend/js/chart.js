class MarketChart {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!window.LightweightCharts) {
      throw new Error('Biblioteca Lightweight Charts não carregada');
    }

    const theme = chartTheme();
    this.tzOffset = -4 * 3600; // UTC-4 (EDT — US Eastern Daylight Time)

    this.chart = LightweightCharts.createChart(this.container, {
      autoSize: true,
      layout: {
        background: { color: theme.card },
        textColor: theme.text,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: theme.border },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    this.theme = theme;
    this.candleSeries = addSeriesCompat(this.chart, 'Candlestick', {
      upColor: theme.bull,
      downColor: theme.bear,
      borderVisible: false,
      wickUpColor: theme.bull,
      wickDownColor: theme.bear,
    });

    this.volumeSeries = addSeriesCompat(this.chart, 'Histogram', {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      scaleMargins: { top: 0.85, bottom: 0 },
      color: theme.bullVolume,
    });

    this.ema9Series = addSeriesCompat(this.chart, 'Line', { color: theme.gold, lineWidth: 1 });
    this.ema21Series = addSeriesCompat(this.chart, 'Line', { color: theme.info, lineWidth: 1 });
    this.sma50Series = addSeriesCompat(this.chart, 'Line', { color: theme.goldSoft, lineWidth: 1 });

      // autoSize:true handles resize automatically in v4+
  }

  applyTheme(isLight) {
    const theme = isLight ? chartThemeLight() : chartThemeDark();
    this.theme = theme;
    this.chart.applyOptions({
      layout: { background: { color: theme.card }, textColor: theme.text },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.border },
    });
    this.candleSeries.applyOptions({
      upColor: theme.bull, downColor: theme.bear,
      wickUpColor: theme.bull, wickDownColor: theme.bear,
    });
    this.ema9Series.applyOptions({ color: theme.gold });
    this.ema21Series.applyOptions({ color: theme.info });
    this.sma50Series.applyOptions({ color: theme.goldSoft });
  }

  _t(utc) { return utc + this.tzOffset; }

  setCandles(candles) {
    const candleData = candles.map((c) => ({ time: this._t(c.time), open: c.open, high: c.high, low: c.low, close: c.close }));
    const volumeData = candles.map((c) => ({
      time: this._t(c.time),
      value: c.volume,
      color: c.close >= c.open ? this.theme.bullVolume : this.theme.bearVolume,
    }));
    this.candleSeries.setData(candleData);
    this.volumeSeries.setData(volumeData);

    this.ema9Series.setData(emaLine(candles, 9, this.tzOffset));
    this.ema21Series.setData(emaLine(candles, 21, this.tzOffset));
    this.sma50Series.setData(smaLine(candles, 50, this.tzOffset));
    this.chart.timeScale().fitContent();
  }

  updateLastCandle(candle) {
    const t = this._t(candle.time);
    this.candleSeries.update({ time: t, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    this.volumeSeries.update({ time: t, value: candle.volume, color: candle.close >= candle.open ? this.theme.bullVolume : this.theme.bearVolume });
  }

  markSupportResistance(pivots) {
    if (!pivots) return;
    if (typeof this.candleSeries.setMarkers === 'function') this.candleSeries.setMarkers([]);
    this.chart.priceScale('right').applyOptions({});
    const lines = [pivots.r2, pivots.r1, pivots.s1, pivots.s2];
    if (this._srLines) this._srLines.forEach((l) => this.candleSeries.removePriceLine(l));
    this._srLines = lines.map((price, i) =>
      this.candleSeries.createPriceLine({
        price,
        color: i < 2 ? this.theme.bear : this.theme.gold,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: i === 0 ? 'R2' : i === 1 ? 'R1' : i === 2 ? 'S1' : 'S2',
      })
    );
  }
}

function chartTheme() {
  return document.documentElement.classList.contains('light')
    ? chartThemeLight()
    : chartThemeDark();
}

function chartThemeDark() {
  return {
    card:       '#030507',
    text:       '#5c7a8e',
    border:     'rgba(0, 212, 255, 0.22)',
    grid:       'rgba(0, 212, 255, 0.04)',
    bull:       '#00ff9c',
    bear:       '#ff3366',
    gold:       '#00d4ff',
    goldSoft:   '#ffb700',
    info:       '#ff2d78',
    bullVolume: 'rgba(0, 255, 156, 0.18)',
    bearVolume: 'rgba(255, 51, 102, 0.18)',
  };
}

function chartThemeLight() {
  return {
    card:       '#ffffff',
    text:       '#3d5566',
    border:     'rgba(0, 111, 168, 0.28)',
    grid:       'rgba(13, 27, 42, 0.05)',
    bull:       '#007a2f',
    bear:       '#c41a2a',
    gold:       '#006fa8',
    goldSoft:   '#9a6000',
    info:       '#b8004a',
    bullVolume: 'rgba(0, 122, 47, 0.18)',
    bearVolume: 'rgba(196, 26, 42, 0.18)',
  };
}

function addSeriesCompat(chart, kind, options) {
  if (typeof chart.addSeries === 'function' && LightweightCharts[`${kind}Series`]) {
    return chart.addSeries(LightweightCharts[`${kind}Series`], options);
  }

  const legacyMethod = `add${kind}Series`;
  if (typeof chart[legacyMethod] === 'function') {
    return chart[legacyMethod](options);
  }

  throw new Error(`Lightweight Charts não suporta ${kind}Series nesta versão`);
}

function emaLine(candles, period, tzOffset = 0) {
  const k = 2 / (period + 1);
  let prev;
  const out = [];
  candles.forEach((c, i) => {
    prev = i === 0 ? c.close : c.close * k + prev * (1 - k);
    out.push({ time: c.time + tzOffset, value: prev });
  });
  return out;
}

function smaLine(candles, period, tzOffset = 0) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    const slice = candles.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, c) => a + c.close, 0) / period;
    out.push({ time: candles[i].time + tzOffset, value: avg });
  }
  return out;
}
