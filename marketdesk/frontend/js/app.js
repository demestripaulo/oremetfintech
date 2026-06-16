const { API_BASE, WS_URL } = window.MARKETDESK_CONFIG;

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
let activeSymbol = 'BTCUSDT';
let activeTimeframe = '15m';
let alertsEnabled = true;
let lastAlertState = { sr: null, rsi: null };

let chart;
let tickerState = {}; // symbol -> { price, changePercent }
let ws;
let wsReconnectAttempts = 0;

function $(id) { return document.getElementById(id); }

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
      renderTickerBar();
      loadAll();
    });
  });
}

async function fetchTickers() {
  try {
    const res = await fetch(`${API_BASE}/api/tickers`);
    const data = await res.json();
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
  const res = await fetch(`${API_BASE}/api/candles?symbol=${activeSymbol}&interval=${activeTimeframe}&limit=200`);
  const data = await res.json();
  chart.setCandles(data.candles);
  return data.candles;
}

async function loadAnalysis() {
  const res = await fetch(`${API_BASE}/api/analysis?symbol=${activeSymbol}`);
  const data = await res.json();
  renderIndicators(data.indicators);
  chart.markSupportResistance(data.indicators.pivots);
  checkAlerts(data.indicators);
  return data.indicators;
}

async function loadPredictions() {
  const res = await fetch(`${API_BASE}/api/predictions?symbol=${activeSymbol}`);
  const data = await res.json();
  renderPredictions(data);
}

async function loadHistory() {
  const res = await fetch(`${API_BASE}/api/history?symbol=${activeSymbol}`);
  const data = await res.json();
  renderHistory(data.log);
}

async function loadAll() {
  await loadCandles();
  await loadAnalysis();
  await loadPredictions();
  await loadHistory();
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

// ---------- WebSocket with exponential backoff reconnect ----------
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    wsReconnectAttempts = 0;
    console.log('WebSocket connected');
  });

  ws.addEventListener('message', (event) => {
    let tick;
    try {
      tick = JSON.parse(event.data);
    } catch {
      return;
    }
    if (tick.type !== 'kline') return;

    const sym = tick.symbol;
    if (SYMBOLS.includes(sym)) {
      tickerState[sym] = tickerState[sym] || { price: tick.candle.close, changePercent: 0 };
      tickerState[sym].price = tick.candle.close;
      renderTickerBar();
    }

    if (sym === activeSymbol) {
      chart.updateLastCandle(tick.candle);
    }
  });

  ws.addEventListener('close', scheduleWsReconnect);
  ws.addEventListener('error', scheduleWsReconnect);
}

function scheduleWsReconnect() {
  wsReconnectAttempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** wsReconnectAttempts);
  console.warn(`WebSocket disconnected, reconnecting in ${delay}ms`);
  setTimeout(connectWS, delay);
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  chart = new MarketChart('chart-container');

  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTimeframe = btn.dataset.tf;
      loadCandles();
    });
  });

  $('alert-toggle').addEventListener('change', (e) => {
    alertsEnabled = e.target.checked;
  });

  fetchTickers();
  loadAll();
  connectWS();

  setInterval(fetchTickers, 5000);
  setInterval(loadAnalysis, 15000);
  setInterval(loadPredictions, 60000);
  setInterval(loadHistory, 60000);
});
