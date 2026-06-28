const { API_BASE: CONNECTORS_API_BASE } = window.MARKETDESK_CONFIG;

async function loadIntelligencePanel() {
  const container = document.getElementById('intelligence-container');
  try {
    const res = await fetch(`${CONNECTORS_API_BASE}/api/connectors/intelligence`);
    const data = await res.json();
    const fg = data.fearGreed || {};
    const sentiment = data.sentiment || {};
    const onChain = data.onChain || {};

    container.innerHTML = `
      <div class="intel-card">
        <div class="intel-label">${withTooltip('Fear &amp; Greed', 'Suporte')}</div>
        <div class="intel-value mono">${fg.value ?? '—'}</div>
        <div class="indicator-explain">${fg.classification || fg.error || ''}</div>
      </div>
      <div class="intel-card">
        <div class="intel-label">${t('socialSentiment')}</div>
        <div class="intel-value mono">${sentiment.sentimentUp != null ? sentiment.sentimentUp.toFixed(0) + '%' : '—'}</div>
        <div class="indicator-explain">${sentiment.error || t('sentimentSrc')}</div>
      </div>
      <div class="intel-card">
        <div class="intel-label">${t('onChain')}</div>
        <div class="intel-value mono">${onChain.activeAddresses?.value ?? '—'}</div>
        <div class="indicator-explain">${onChain.activeAddresses?.error || t('activeAddresses')}</div>
      </div>
      <div class="intel-card">
        <div class="intel-label">${t('exchangeNetflow')}</div>
        <div class="intel-value mono">${onChain.exchangeNetflow?.value != null ? onChain.exchangeNetflow.value.toFixed(2) : '—'}</div>
        <div class="indicator-explain">${onChain.exchangeNetflow?.error || t('exchangeSrc')}</div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="indicator-explain">${t('externalUnavailable')}${err.message}</p>`;
  }
}

async function loadNewsFeed() {
  const container = document.getElementById('news-container');
  try {
    const res = await fetch(`${CONNECTORS_API_BASE}/api/connectors/news`);
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<p class="indicator-explain">${t('noNews')}</p>`;
      return;
    }
    container.innerHTML = data.items.map((item) => `
      <div class="news-item">
        <div class="news-title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></div>
        <div class="news-meta">
          <span class="badge ${item.sentiment === 'BULLISH' ? 'buy' : item.sentiment === 'BEARISH' ? 'sell' : 'neutral'}">${item.sentiment}</span>
          <span class="indicator-explain">${item.source || ''}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="indicator-explain">${t('newsUnavailable')}${err.message}</p>`;
  }
}

// Kalshi 15-min targets — only BTC/ETH have these short-horizon markets.
const KALSHI_ASSET = { BTCUSDT: 'BTC', ETHUSDT: 'ETH' };

const fmtUsd = (n) => '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Human label for a Kalshi target based on its strike type.
function kalshiTargetLabel(tgt) {
  const { strikeType, floorStrike, capStrike } = tgt;
  if (strikeType === 'between' && floorStrike != null && capStrike != null) {
    return `${fmtUsd(floorStrike)} – ${fmtUsd(capStrike)}`;
  }
  if (strikeType && strikeType.startsWith('less') && (capStrike ?? floorStrike) != null) {
    return `≤ ${fmtUsd(capStrike ?? floorStrike)}`;
  }
  if (strikeType && strikeType.startsWith('greater') && floorStrike != null) {
    return `≥ ${fmtUsd(floorStrike)}`;
  }
  return tgt.title || '—';
}

// Is spot currently on the YES side of this target?
function kalshiYesSide(tgt, spot) {
  if (spot == null) return null;
  const { strikeType, floorStrike, capStrike } = tgt;
  if (strikeType === 'between' && floorStrike != null && capStrike != null) return spot >= floorStrike && spot <= capStrike;
  if (strikeType && strikeType.startsWith('less')) return spot <= (capStrike ?? floorStrike);
  if (strikeType && strikeType.startsWith('greater')) return spot >= floorStrike;
  return null;
}

// Reliability readout: Brier scores + model skill vs the market.
function renderKalshiCalibration(c) {
  if (!c || c.samples == null) return '';
  if (c.samples === 0) {
    return `<div class="kalshi-calib indicator-explain">${t('kxCalibTitle')}: ${t('kxCalibPending')}</div>`;
  }
  const fmt = (x) => (x == null ? '—' : x.toFixed(3));
  const skill = c.skillVsMarket;
  const skillTxt = skill == null ? '—' : `${skill > 0 ? '+' : ''}${(skill * 100).toFixed(0)}%`;
  const skillClass = skill != null && skill > 0 ? 'kx-agree' : 'kx-diverge';
  return `
    <div class="kalshi-calib indicator-explain">
      <b>${t('kxCalibTitle')}</b> · n=${c.samples} ·
      ${t('kxCalibModel')} <span class="mono">${fmt(c.modelBrier)}</span> ·
      ${t('kxCalibMarket')} <span class="mono">${fmt(c.marketBrier)}</span> ·
      ${t('kxCalibSkill')} <span class="${skillClass}">${skillTxt}</span>
    </div>`;
}

// Phase-1 paper-trading readout (simulated, no real money).
function renderKalshiPaper(p) {
  if (!p || p.trades == null) return '';
  if (p.trades === 0) {
    return `<div class="kalshi-calib indicator-explain"><b>${t('kxPaperTitle')}</b>: ${t('kxPaperPending')}</div>`;
  }
  const pnlClass = p.pnl >= 0 ? 'kx-agree' : 'kx-diverge';
  const roiTxt = p.roi != null ? `${p.roi > 0 ? '+' : ''}${(p.roi * 100).toFixed(0)}%` : '—';
  return `
    <div class="kalshi-calib indicator-explain">
      <b>${t('kxPaperTitle')}</b> · ${p.trades} ${t('kxPaperTrades')} ·
      ${t('kxPaperPnl')} <span class="mono ${pnlClass}">${p.pnl >= 0 ? '+' : ''}${p.pnl}</span> ·
      ROI <span class="${pnlClass}">${roiTxt}</span> ·
      ${t('kxPaperHit')} ${p.hitRate != null ? (p.hitRate * 100).toFixed(0) + '%' : '—'}
      <div class="kx-paper-note">${t('kxPaperNote')}</div>
    </div>`;
}

// Compact badge summarizing the model-vs-market crossing for a target.
function kalshiVerdictBadge(cross) {
  if (!cross || !cross.signal) return '<span class="indicator-explain">—</span>';
  const edgePts = cross.edge != null ? `${cross.edge > 0 ? '+' : ''}${(cross.edge * 100).toFixed(0)}pt` : '';
  switch (cross.signal) {
    case 'AGREE_YES': return `<span class="kx-agree">${t('kxAgree')} ✓</span>`;
    case 'AGREE_NO':  return `<span class="kx-agree">${t('kxAgreeNo')} ✓</span>`;
    case 'DIVERGE':   return `<span class="kx-diverge">${t('kxDiverge')} ${edgePts}</span>`;
    case 'MODEL_ONLY': return `<span class="indicator-explain">${t('kxModelOnly')}</span>`;
    default: return '<span class="indicator-explain">—</span>';
  }
}

function renderKalshiSection(data, spot, horizonLabel) {
  if (!data || data.error || !Array.isArray(data.targets) || data.targets.length === 0) {
    return `<div class="kalshi-section"><div class="kalshi-head indicator-explain"><b>${horizonLabel}</b> — ${t('kalshiUnavailable')}${data?.error || '—'}</div></div>`;
  }
  const closeLabel = data.closeTime
    ? new Date(data.closeTime).toLocaleTimeString(window.LANG === 'pt' ? 'pt-BR' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : '';
  const pct = (p) => (p != null ? `${(p * 100).toFixed(0)}%` : '—');
  const rows = data.targets.map((tgt) => {
    const mkt = pct(tgt.impliedProb);
    const mktClass = tgt.impliedProb != null && tgt.impliedProb >= 0.5 ? 'kalshi-hi' : 'kalshi-lo';
    const mdl = pct(tgt.modelProb);
    const mdlClass = tgt.modelProb != null && tgt.modelProb >= 0.5 ? 'kalshi-hi' : 'kalshi-lo';
    const yes = kalshiYesSide(tgt, spot);
    const label = kalshiTargetLabel(tgt);
    const verdict = kalshiVerdictBadge(tgt.cross);
    return `<tr class="${yes ? 'kalshi-atm' : ''}">
      <td class="mono">${label}</td>
      <td class="mono ${mktClass}">${mkt}</td>
      <td class="mono ${mdlClass}">${mdl}</td>
      <td>${verdict}</td>
    </tr>`;
  }).join('');
  return `
    <div class="kalshi-section">
      <div class="kalshi-head indicator-explain"><b>${horizonLabel}</b> · ${t('kalshiWindow')} ${closeLabel} · ${data.totalInWindow ?? data.count} ${t('kalshiMarkets')}</div>
      <table class="history-table">
        <thead><tr><th>${t('kalshiStrike')}</th><th>${t('kalshiMarket')}</th><th>${t('kalshiModel')}</th><th>${t('kalshiVerdict')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function loadKalshiTargets() {
  const container = document.getElementById('kalshi-container');
  if (!container) return;
  const asset = KALSHI_ASSET[window.activeSymbol];
  if (!asset) {
    container.innerHTML = `<p class="indicator-explain">${t('kalshiOnlyBtcEth')}</p>`;
    return;
  }
  const spot = window.tickerState?.[window.activeSymbol]?.price;
  const priceParam = spot ? `&price=${spot}` : '';
  const fetchHz = (hz) => fetch(`${CONNECTORS_API_BASE}/api/connectors/kalshi?asset=${asset}&horizon=${hz}${priceParam}`)
    .then((r) => r.json()).catch((err) => ({ error: err.message }));
  try {
    const [m15, h1, calib, paper] = await Promise.all([
      fetchHz('15m'),
      fetchHz('1h'),
      fetch(`${CONNECTORS_API_BASE}/api/calibration?symbol=${window.activeSymbol}`).then((r) => r.json()).catch(() => null),
      fetch(`${CONNECTORS_API_BASE}/api/paper?symbol=${window.activeSymbol}`).then((r) => r.json()).catch(() => null),
    ]);
    const spotLabel = spot != null ? `<div class="indicator-explain kalshi-spot">${t('currentPrice')}: <span class="mono">${fmtUsd(spot)}</span></div>` : '';
    container.innerHTML = spotLabel
      + renderKalshiSection(m15, spot, t('kalshiH15'))
      + renderKalshiSection(h1, spot, t('kalshiH1'))
      + renderKalshiCalibration(calib)
      + renderKalshiPaper(paper);
  } catch (err) {
    container.innerHTML = `<p class="indicator-explain">${t('kalshiUnavailable')}${err.message}</p>`;
  }
}
window.loadKalshiTargets = loadKalshiTargets;

document.addEventListener('DOMContentLoaded', () => {
  loadIntelligencePanel();
  loadNewsFeed();
  loadKalshiTargets();

  setInterval(loadIntelligencePanel, 60 * 60 * 1000);
  setInterval(loadNewsFeed, 5 * 60 * 1000);
  setInterval(loadKalshiTargets, 30 * 1000);
});
