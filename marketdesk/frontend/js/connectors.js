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
  try {
    const res = await fetch(`${CONNECTORS_API_BASE}/api/connectors/kalshi?asset=${asset}${priceParam}`);
    const data = await res.json();
    if (data.error || !Array.isArray(data.targets) || data.targets.length === 0) {
      container.innerHTML = `<p class="indicator-explain">${t('kalshiUnavailable')}${data.error || ''}</p>`;
      return;
    }
    const closeLabel = data.closeTime
      ? new Date(data.closeTime).toLocaleTimeString(window.LANG === 'pt' ? 'pt-BR' : 'en-US', { hour: '2-digit', minute: '2-digit' })
      : '';
    const dur = data.windowMinutes ? `${data.windowMinutes}min · ` : '';
    const spotLabel = spot != null ? `<span class="indicator-explain"> · ${t('currentPrice')}: <span class="mono">${fmtUsd(spot)}</span></span>` : '';
    const rows = data.targets.map((tgt) => {
      const prob = tgt.impliedProb != null ? `${(tgt.impliedProb * 100).toFixed(0)}%` : '—';
      const probClass = tgt.impliedProb != null && tgt.impliedProb >= 0.5 ? 'kalshi-hi' : 'kalshi-lo';
      const yes = kalshiYesSide(tgt, spot);
      const label = kalshiTargetLabel(tgt);
      return `<tr class="${yes ? 'kalshi-atm' : ''}">
        <td class="mono">${label}</td>
        <td class="mono ${probClass}">${prob}</td>
      </tr>`;
    }).join('');
    container.innerHTML = `
      <div class="kalshi-head indicator-explain">${t('kalshiWindow')} ${closeLabel} · ${dur}${data.totalInWindow ?? data.count} ${t('kalshiMarkets')}${spotLabel}</div>
      <table class="history-table">
        <thead><tr><th>${t('kalshiStrike')}</th><th>${t('kalshiProb')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
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
