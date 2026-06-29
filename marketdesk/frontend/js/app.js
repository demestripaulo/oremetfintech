const { API_BASE, WS_URL } = window.MARKETDESK_CONFIG;

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
let activeSymbol = 'BTCUSDT';
let activeTimeframe = '1m';
let alertsEnabled = true;
let lastAlertState = { sr: null, rsi: null };

let chart;
let chartFitted = false;
let tickerState = {};
let ws;
let wsReconnectAttempts = 0;

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

// ---------- NYSE-style alert ticker ----------
const alertQueue = [];
let alertRunning = false;

function showToast(message) {
  if (alertsEnabled) playBeep();
  alertQueue.push(message);
  if (!alertRunning) drainAlertQueue();
}

function drainAlertQueue() {
  const strip = $('alert-strip');
  const textEl = $('alert-strip-text');
  if (alertQueue.length === 0) {
    if (strip) strip.classList.remove('visible');
    alertRunning = false;
    return;
  }
  alertRunning = true;
  if (!strip || !textEl) { alertQueue.length = 0; alertRunning = false; return; }
  const msg = alertQueue.shift();
  textEl.textContent = msg;
  const duration = Math.max(12000, msg.length * 110);
  strip.classList.add('visible');
  textEl.style.animation = 'none';
  void textEl.offsetWidth;
  textEl.style.animation = `alert-marquee ${duration}ms linear forwards`;
  setTimeout(drainAlertQueue, duration);
}

// ---------- Ticker bar ----------
window.activeSymbol = activeSymbol;
window.tickerState = tickerState; // exposed for the Kalshi panel (same ref, mutated in place)

// Cache of per-symbol DOM nodes so updates touch only text/classes instead of
// rebuilding innerHTML (avoids reflow + listener churn on every WS tick).
const tickerEls = {};
let tickerBuilt = false;
let tickerRafPending = false;

function buildTickerBar() {
  const bar = $('ticker-bar');
  if (!bar) return;
  bar.innerHTML = '';
  SYMBOLS.forEach((sym) => {
    const item = document.createElement('div');
    item.className = 'ticker-item';
    item.dataset.symbol = sym;
    item.innerHTML =
      `<div class="symbol">${sym.replace('USDT', '/USDT')}</div>` +
      `<div class="price mono">...</div>` +
      `<div class="change mono">0.00%</div>`;
    bar.appendChild(item);
    tickerEls[sym] = {
      item,
      price: item.querySelector('.price'),
      change: item.querySelector('.change'),
    };
  });
  // Single delegated listener — bound once, never re-added.
  bar.addEventListener('click', (e) => {
    const item = e.target.closest('.ticker-item');
    if (!item) return;
    activeSymbol = item.dataset.symbol;
    window.activeSymbol = activeSymbol;
    chartFitted = false;
    renderTickerBar();
    loadAll();
  });
  tickerBuilt = true;
}

// Coalesce repaints to at most one per animation frame.
function scheduleTickerRender() {
  if (tickerRafPending) return;
  tickerRafPending = true;
  requestAnimationFrame(() => { tickerRafPending = false; renderTickerBar(); });
}

function renderTickerBar() {
  if (!tickerBuilt) buildTickerBar();
  SYMBOLS.forEach((sym) => {
    const els = tickerEls[sym];
    if (!els) return;
    const t = tickerState[sym];
    const price = t ? t.price.toFixed(2) : '...';
    const change = t ? t.changePercent : 0;
    els.price.textContent = `$${price}`;
    els.change.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    els.change.className = `change mono ${change >= 0 ? 'up' : 'down'}`;
    els.item.classList.toggle('active', sym === activeSymbol);
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
async function loadCandles({ fit } = {}) {
  if (!chart) return [];
  setChartMessage(`${t('loadingCandles')} ${activeSymbol}...`);
  try {
    const res = await fetch(`${API_BASE}/api/candles?symbol=${activeSymbol}&interval=${activeTimeframe}&limit=200`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!Array.isArray(data.candles) || data.candles.length === 0) throw new Error('empty candles');
    const shouldFit = fit ?? !chartFitted;
    chart.setCandles(data.candles, { fit: shouldFit });
    chartFitted = true;
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
    renderHistory(data);
  } catch (err) {
    console.error('Failed to load history', err);
    setPanelMessage('history-container', `${t('historyUnavailable')}: ${err.message}`, 'error');
  }
}

async function loadAll() {
  window.loadKalshiTargets?.(); // symbol-aware Kalshi targets (BTC/ETH only)
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

// ---------- Countdown prediction refreshes ----------
const PRED_COUNTDOWN_MARKS = [15 * 60, 10 * 60, 5 * 60, 4 * 60, 3 * 60, 2 * 60, 60];
let countdownTimers = [];

function scheduleCountdownRefreshes() {
  // Clear any timers left from the previous window so they never stack up.
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];

  const nowSec = Date.now() / 1000;
  const nextBoundary = Math.ceil(nowSec / 900) * 900;
  const secsToNext = nextBoundary - nowSec;

  for (const mark of PRED_COUNTDOWN_MARKS) {
    const delay = secsToNext - mark;
    if (delay > 0) countdownTimers.push(setTimeout(() => { loadPredictions(); }, delay * 1000));
  }

  countdownTimers.push(setTimeout(() => {
    loadPredictions();
    scheduleCountdownRefreshes();
  }, secsToNext * 1000));
}

// ---------- WebSocket ----------
let wsReconnectScheduled = false;

function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    wsReconnectAttempts = 0;
    console.log('[MarketDesk] WS connected');
  });

  ws.addEventListener('message', (event) => {
    let tick;
    try { tick = JSON.parse(event.data); } catch { return; }
    if (tick.type !== 'kline') return;
    const sym = tick.symbol;
    if (SYMBOLS.includes(sym)) {
      if (!tickerState[sym]) tickerState[sym] = { price: tick.candle.close, changePercent: 0 };
      tickerState[sym].price = tick.candle.close;
      scheduleTickerRender();
    }
    if (sym !== activeSymbol) return;
    chart?.updateLastCandle(tick.candle);
  });

  ws.addEventListener('close', scheduleWsReconnect);
  ws.addEventListener('error', scheduleWsReconnect);
}

function scheduleWsReconnect() {
  // close + error can both fire for one dead socket — schedule only once.
  if (wsReconnectScheduled) return;
  wsReconnectScheduled = true;
  wsReconnectAttempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** wsReconnectAttempts);
  console.warn(`[MarketDesk] WS disconnected, retry in ${delay}ms`);
  setTimeout(() => { wsReconnectScheduled = false; connectWS(); }, delay);
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
      chartFitted = false;
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
  connectWS();

  setInterval(fetchTickers, 5000);
  setInterval(() => { if (activeTimeframe !== '1m') loadCandles(); }, 15000);
  setInterval(loadAnalysis, 15000);
  setInterval(loadHistory, 60000);
  scheduleCountdownRefreshes();
});
