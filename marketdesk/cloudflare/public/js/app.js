const { API_BASE, WS_URL, USE_BINANCE_DIRECT_WS = true } = window.MARKETDESK_CONFIG;

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
let activeSymbol = 'BTCUSDT';
let activeTimeframe = '1m';
let alertsEnabled = true;
let lastAlertState = { sr: null, rsi: null };

let chart;
let tickerState = {};
let ws;
let wsReconnectAttempts = 0;

// Binance direct WebSocket state
const BINANCE_WS_URL = 'wss://stream.binance.com/stream?streams=' +
  ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt'].map(s => `${s}@kline_1m`).join('/');
let binanceWs = null;
let binanceReconnectAttempts = 0;
let binanceWsActive = false;

// Seconds per timeframe — used to align 1m ticks to the current candle's boundary.
const TF_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 };

function $(id) { return document.getElementById(id); }

function setPanelMessage(id, message, tone = 'muted') {
  const container = $(id);
  if (!container) return;
  container.innerHTML = `<p class="panel-message ${tone}">${message}</p>`;
}

function setChartMessage(message, tone = 'muted') {
  const container = $('chart-container');
  if (!container) return;
  let overlay = container.querySelector('.chart-state');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'chart-state';
    container.appendChild(overlay);
  }
  overlay.textContent = message;
  overlay.className = `chart-state ${tone}`;
}

function clearChartMessage() {
  const overlay = $('chart-container')?.querySelector('.chart-state');
  if (overlay) overlay.remove();
}

// ---------- Toasts / alerts ----------
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch (e) { /* audio not available */ }
}

function showToast(message) {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 8000);
  if (alertsEnabled) playBeep();
}

// ---------- Ticker bar ----------
window.activeSymbol = activeSymbol;

function renderTickerBar() {
  const bar = $('ticker-bar');
  bar.innerHTML = SYMBOLS.map((sym) => {
    const t = tickerState[sym];
    const price = t ? t.price.toFixed(2) : '...';
    const change = t ? t.changePercent : 0;
    const changeClass = change >= 0 ? 'up' : 'down';
    return `
      <div class="ticker-item ${sym === activeSymbol ? 'active' : ''}" data-symbol="${sym}">
        <div class="symbol">${sym.replace('USDT', '/USDT')}</div>
        <div class="price mono">$${price}</div>
        <div class="change ${changeClass} mono">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</div>
      </div>
    `;
  }).join('');

  bar.querySelectorAll('.ticker-item').forEach((el) => {
    el.addEventListener('click', () => {
      activeSymbol = el.dataset.symbol;
      window.activeSymbol = activeSymbol;
      renderTickerBar();
      loadAll();
    });
  });
}

async function fetchTickers() {
  try {
    const res = await fetch(`${API_BASE}/api/tickers`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!Array.isArray(data.tickers)) throw new Error('API retornou tickers inválidos');
    data.tickers.forEach((t) => {
      tickerState[t.symbol] = { price: t.price, changePercent: t.changePercent };
    });
    renderTickerBar();
  } catch (err) {
    console.error('Failed to fetch tickers', err);
  }
}

// ---------- REST loaders ----------
async function loadCandles() {
  if (!chart) return [];
  setChartMessage(`${t('loadingCandles')} ${activeSymbol}...`);
  try {
    const res = await fetch(`${API_BASE}/api/candles?symbol=${activeSymbol}&interval=${activeTimeframe}&limit=200`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!Array.isArray(data.candles) || data.candles.length === 0) {
      throw new Error('API returned empty candles');
    }
    chart.setCandles(data.candles);
    clearChartMessage();
    const srcEl = $('chart-source');
    if (srcEl) srcEl.textContent = data.source ? `via ${data.source}` : '';
    return data.candles;
  } catch (err) {
    console.error('Failed to load candles', err);
    setChartMessage(`${t('candlesUnavailable')}: ${err.message}`, 'error');
    return [];
  }
}

async function loadAnalysis() {
  try {
    const res = await fetch(`${API_BASE}/api/analysis?symbol=${activeSymbol}&interval=${activeTimeframe}&lang=${window.LANG || 'en'}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderIndicators(data.indicators);
    chart?.markSupportResistance(data.indicators.pivots);
    checkAlerts(data.indicators);
    return data.indicators;
  } catch (err) {
    console.error('Failed to load analysis', err);
    setPanelMessage('indicators-container', `${t('indicatorsUnavailable')}: ${err.message}`, 'error');
    setPanelMessage('sr-container', t('srUnavailable'), 'error');
    setPanelMessage('connectors-container', t('connectorsUnavailable'), 'error');
    return null;
  }
}

async function loadPredictions() {
  setPanelMessage('predictions-container', t('generatingPredictions'));
  try {
    const res = await fetch(`${API_BASE}/api/predictions?symbol=${activeSymbol}&lang=${window.LANG || 'en'}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderPredictions(data);
  } catch (err) {
    console.error('Failed to load predictions', err);
    setPanelMessage('predictions-container', `${t('predictionsUnavailable')}: ${err.message}`, 'error');
  }
}

async function loadHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/history?symbol=${activeSymbol}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderHistory(data.log);
  } catch (err) {
    console.error('Failed to load history', err);
    setPanelMessage('history-container', `${t('historyUnavailable')}: ${err.message}`, 'error');
  }
}

async function loadAll() {
  await Promise.allSettled([
    loadCandles(),
    loadAnalysis(),
    loadPredictions(),
    loadHistory(),
  ]);
}

// ---------- Alerts ----------
function checkAlerts(indicators) {
  const { price, pivots, rsi } = indicators;
  const tolerance = price * 0.0015;

  const levels = [
    { name: 'R1', value: pivots.r1 },
    { name: 'R2', value: pivots.r2 },
    { name: 'S1', value: pivots.s1 },
    { name: 'S2', value: pivots.s2 },
  ];
  for (const lvl of levels) {
    if (Math.abs(price - lvl.value) <= tolerance) {
      const key = `${activeSymbol}-${lvl.name}`;
      if (lastAlertState.sr !== key) {
        lastAlertState.sr = key;
        showToast(`${activeSymbol}: preço tocou nível ${lvl.name} (${lvl.value.toFixed(2)})`);
      }
      break;
    }
  }

  if (rsi.value > 70 || rsi.value < 30) {
    const key = `${activeSymbol}-rsi-${rsi.value > 70 ? 'over' : 'oversold'}`;
    if (lastAlertState.rsi !== key) {
      lastAlertState.rsi = key;
      showToast(`${activeSymbol}: RSI em zona extrema (${rsi.value})`);
    }
  } else {
    lastAlertState.rsi = null;
  }
}

// ---------- Shared real-time tick handler ----------
// Aligns the 1m candle time to the current timeframe boundary before updating
// the chart, so the pulse replaces the last candle instead of appending a new one.
function applyRealtimeTick(symbol, candle) {
  if (SYMBOLS.includes(symbol)) {
    if (!tickerState[symbol]) tickerState[symbol] = { price: candle.close, changePercent: 0 };
    tickerState[symbol].price = candle.close;
    renderTickerBar();
  }
  if (symbol !== activeSymbol) return;
  const period = TF_SECONDS[activeTimeframe] || 60;
  const aligned = { ...candle, time: candle.time - (candle.time % period) };
  chart?.updateLastCandle(aligned);
}

// ---------- Binance direct WebSocket (primary) ----------
function connectBinanceWS() {
  if (!USE_BINANCE_DIRECT_WS) { connectWS(); return; }

  try { binanceWs = new WebSocket(BINANCE_WS_URL); }
  catch { connectWS(); return; }

  binanceWs.addEventListener('open', () => {
    binanceReconnectAttempts = 0;
    binanceWsActive = true;
    console.log('[MarketDesk] Binance direct WS connected');
    connectWS(); // keep DO relay alive as fallback
  });

  binanceWs.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    const k = msg.data?.k;
    if (!k) return;
    applyRealtimeTick(k.s, {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    });
  });

  binanceWs.addEventListener('close', () => { binanceWsActive = false; scheduleBinanceReconnect(); });
  binanceWs.addEventListener('error', () => { binanceWsActive = false; scheduleBinanceReconnect(); });
}

function scheduleBinanceReconnect() {
  binanceReconnectAttempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** binanceReconnectAttempts);
  console.warn(`[MarketDesk] Binance WS disconnected, retry in ${delay}ms`);
  setTimeout(connectBinanceWS, delay);
}

// ---------- DO relay WebSocket (fallback) ----------
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    wsReconnectAttempts = 0;
    console.log('[MarketDesk] DO relay WS connected');
  });

  ws.addEventListener('message', (event) => {
    let tick;
    try { tick = JSON.parse(event.data); } catch { return; }
    if (tick.type !== 'kline') return;
    // Defer to Binance when active; relay still updates ticker as backup.
    if (binanceWsActive) {
      const sym = tick.symbol;
      if (SYMBOLS.includes(sym)) {
        if (!tickerState[sym]) tickerState[sym] = { price: tick.candle.close, changePercent: 0 };
        tickerState[sym].price = tick.candle.close;
      }
      return;
    }
    applyRealtimeTick(tick.symbol, tick.candle);
  });

  ws.addEventListener('close', scheduleWsReconnect);
  ws.addEventListener('error', scheduleWsReconnect);
}

function scheduleWsReconnect() {
  wsReconnectAttempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** wsReconnectAttempts);
  console.warn(`[MarketDesk] DO relay WS disconnected, retry in ${delay}ms`);
  setTimeout(connectWS, delay);
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  setChartMessage(t('initializingChart'));
  try {
    chart = new MarketChart('chart-container');
  } catch (err) {
    console.error('Failed to initialize chart', err);
    setChartMessage(`Gráfico indisponível: ${err.message}`, 'error');
  }

  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTimeframe = btn.dataset.tf;
      Promise.allSettled([loadCandles(), loadAnalysis()]);
    });
  });

  $('alert-toggle').addEventListener('change', (e) => {
    alertsEnabled = e.target.checked;
  });

  const themeBtn = $('theme-toggle');
  if (themeBtn) {
    const syncThemeBtn = () => {
      const isLight = document.documentElement.classList.contains('light');
      themeBtn.textContent = isLight ? 'DARK' : 'LIGHT';
    };
    syncThemeBtn();
    themeBtn.addEventListener('click', () => {
      const isLight = document.documentElement.classList.toggle('light');
      localStorage.setItem('md_theme', isLight ? 'light' : 'dark');
      chart?.applyTheme(isLight);
      syncThemeBtn();
    });
  }

  fetchTickers();
  loadAll();
  connectBinanceWS(); // starts Binance direct WS; falls back to DO relay if disabled/unavailable

  setInterval(fetchTickers, 5000);
  setInterval(() => { if (activeTimeframe !== '1m') loadCandles(); }, 15000);
  setInterval(loadAnalysis, 15000);
  setInterval(loadPredictions, 60000);
  setInterval(loadHistory, 60000);
});
