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

document.addEventListener('DOMContentLoaded', () => {
  loadIntelligencePanel();
  loadNewsFeed();

  setInterval(loadIntelligencePanel, 60 * 60 * 1000);
  setInterval(loadNewsFeed, 5 * 60 * 1000);
});
