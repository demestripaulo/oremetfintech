class MarketChart {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!window.LightweightCharts) {
      throw new Error('Biblioteca Lightweight Charts não carregada');
    }

    const theme = chartTheme();
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

  setCandles(candles) {
    const candleData = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const volumeData = candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? this.theme.bullVolume : this.theme.bearVolume,
    }));
    this.candleSeries.setData(candleData);
    this.volumeSeries.setData(volumeData);

    this.ema9Series.setData(emaLine(candles, 9));
    this.ema21Series.setData(emaLine(candles, 21));
    this.sma50Series.setData(smaLine(candles, 50));
  }

  updateLastCandle(candle) {
    this.candleSeries.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    this.volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? this.theme.bullVolume : this.theme.bearVolume });
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
  return {
    card: '#050e1a',
    text: '#33FF77',
    border: 'rgba(212, 175, 55, 0.4)',
    grid: 'rgba(51, 255, 119, 0.05)',
    bull: '#00E676',
    bear: '#FF1744',
    gold: '#D4AF37',
    goldSoft: '#F3E6B3',
    info: '#7EA6D9',
    bullVolume: 'rgba(0, 230, 118, 0.22)',
    bearVolume: 'rgba(255, 23, 68, 0.22)',
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

function emaLine(candles, period) {
  const k = 2 / (period + 1);
  let prev;
  const out = [];
  candles.forEach((c, i) => {
    prev = i === 0 ? c.close : c.close * k + prev * (1 - k);
    out.push({ time: c.time, value: prev });
  });
  return out;
}

function smaLine(candles, period) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    const slice = candles.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, c) => a + c.close, 0) / period;
    out.push({ time: candles[i].time, value: avg });
  }
  return out;
}
