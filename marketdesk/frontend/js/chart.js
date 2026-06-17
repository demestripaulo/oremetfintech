class MarketChart {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!window.LightweightCharts) {
      throw new Error('Biblioteca Lightweight Charts não carregada');
    }

    const theme = chartTheme();
    this.chart = LightweightCharts.createChart(this.container, {
      width: this.container.clientWidth,
      height: this.container.clientHeight || 420,
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

    window.addEventListener('resize', () => {
      this.chart.applyOptions({ width: this.container.clientWidth, height: this.container.clientHeight || 420 });
    });
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
  const styles = getComputedStyle(document.documentElement);
  const css = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    card: css('--card', '#102A4C'),
    text: css('--text', '#F7F4EC'),
    border: css('--border', 'rgba(212, 175, 55, 0.22)'),
    grid: css('--chart-grid', 'rgba(243, 230, 179, 0.08)'),
    bull: css('--bull', '#D4AF37'),
    bear: css('--bear', '#C94C4C'),
    gold: css('--gold', '#D4AF37'),
    goldSoft: css('--gold-soft', '#F3E6B3'),
    info: css('--info', '#7EA6D9'),
    bullVolume: css('--bull-volume', 'rgba(212, 175, 55, 0.35)'),
    bearVolume: css('--bear-volume', 'rgba(201, 76, 76, 0.35)'),
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
