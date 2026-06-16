class MarketChart {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.chart = LightweightCharts.createChart(this.container, {
      layout: {
        background: { color: '#1e1e21' },
        textColor: '#e8e8ea',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#00c896',
      downColor: '#ff4757',
      borderVisible: false,
      wickUpColor: '#00c896',
      wickDownColor: '#ff4757',
    });

    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      scaleMargins: { top: 0.85, bottom: 0 },
      color: 'rgba(0,200,150,0.4)',
    });

    this.ema9Series = this.chart.addLineSeries({ color: '#f5b942', lineWidth: 1 });
    this.ema21Series = this.chart.addLineSeries({ color: '#00c8ff', lineWidth: 1 });
    this.sma50Series = this.chart.addLineSeries({ color: '#a78bfa', lineWidth: 1 });

    window.addEventListener('resize', () => {
      this.chart.applyOptions({ width: this.container.clientWidth });
    });
  }

  setCandles(candles) {
    const candleData = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const volumeData = candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0,200,150,0.4)' : 'rgba(255,71,87,0.4)',
    }));
    this.candleSeries.setData(candleData);
    this.volumeSeries.setData(volumeData);

    this.ema9Series.setData(emaLine(candles, 9));
    this.ema21Series.setData(emaLine(candles, 21));
    this.sma50Series.setData(smaLine(candles, 50));
  }

  updateLastCandle(candle) {
    this.candleSeries.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    this.volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? 'rgba(0,200,150,0.4)' : 'rgba(255,71,87,0.4)' });
  }

  markSupportResistance(pivots) {
    this.candleSeries.setMarkers([]);
    this.chart.priceScale('right').applyOptions({});
    const lines = [pivots.r2, pivots.r1, pivots.s1, pivots.s2];
    if (this._srLines) this._srLines.forEach((l) => this.candleSeries.removePriceLine(l));
    this._srLines = lines.map((price, i) =>
      this.candleSeries.createPriceLine({
        price,
        color: i < 2 ? '#ff4757' : '#00c896',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: i === 0 ? 'R2' : i === 1 ? 'R1' : i === 2 ? 'S1' : 'S2',
      })
    );
  }
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
