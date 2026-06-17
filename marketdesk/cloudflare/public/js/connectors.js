const { API_BASE: CONNECTORS_API_BASE } = window.MARKETDESK_CONFIG;

function biasBadge(score) {
  if (score == null) return 'neutral';
  if (score >= 7) return 'buy';
  if (score <= 4) return 'sell';
  return 'neutral';
}

async function loadDanelfinPanel() {
  const container = document.getElementById('danelfin-container');
  container.innerHTML = '<p class="panel-message">Verificando correlatos BTC...</p>';
  try {
    const res = await fetch(`${CONNECTORS_API_BASE}/api/connectors/danelfin`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.configured === false) {
      const tickers = data.tickers || ['MSTR', 'COIN', 'MARA', 'RIOT', 'IBIT'];
      container.innerHTML = `
        <div class="connector-notice">
          <div class="notice-title">Configuração pendente</div>
          <div class="indicator-explain">${data.message || 'Danelfin API key não configurada. Os correlatos BTC serão exibidos quando a chave for adicionada ao Worker.'}</div>
        </div>
        <div class="ticker-chip-row">
          ${tickers.map((ticker) => `<span class="ticker-chip">${ticker}</span>`).join('')}
        </div>
        <p class="indicator-explain">${data.note || 'Nenhum score foi estimado.'}</p>
      `;
      return;
    }

    if (!Array.isArray(data.scores) || data.scores.length === 0) {
      container.innerHTML = '<p class="panel-message">Nenhum correlato BTC disponível no momento.</p>';
      return;
    }

    container.innerHTML = data.scores.map((s) => {
      if (s.error) {
        return `<div class="danelfin-card muted"><div class="ticker">${s.ticker}</div><div class="indicator-explain">${s.error}</div></div>`;
      }
      const pct = (s.aiScore / 10) * 100;
      return `
        <div class="danelfin-card">
          <div class="ticker">${s.ticker}</div>
          <div class="confidence-bar-bg"><div class="confidence-bar-fill" style="width:${pct}%"></div></div>
          <div class="indicator-explain">Score ${s.aiScore}/10</div>
          <span class="badge ${biasBadge(s.aiScore)}">${s.signal || 'N/A'}</span>
        </div>
      `;
    }).join('');
    const note = document.createElement('div');
    note.className = 'indicator-explain';
    note.style.marginTop = '8px';
    note.textContent = data.note;
    container.appendChild(note);
  } catch (err) {
    container.innerHTML = `<p class="panel-message error">Painel Danelfin indisponível: ${err.message}</p>`;
  }
}

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
        <div class="intel-label">Sentimento social</div>
        <div class="intel-value mono">${sentiment.sentimentUp != null ? sentiment.sentimentUp.toFixed(0) + '%' : '—'}</div>
        <div class="indicator-explain">${sentiment.error || 'Votos positivos (CoinGecko)'}</div>
      </div>
      <div class="intel-card">
        <div class="intel-label">On-chain (Glassnode)</div>
        <div class="intel-value mono">${onChain.activeAddresses?.value ?? '—'}</div>
        <div class="indicator-explain">${onChain.activeAddresses?.error || 'Endereços ativos'}</div>
      </div>
      <div class="intel-card">
        <div class="intel-label">Exchange netflow</div>
        <div class="intel-value mono">${onChain.exchangeNetflow?.value != null ? onChain.exchangeNetflow.value.toFixed(2) : '—'}</div>
        <div class="indicator-explain">${onChain.exchangeNetflow?.error || 'BTC (Glassnode)'}</div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="indicator-explain">Inteligência externa indisponível: ${err.message}</p>`;
  }
}

async function loadNewsFeed() {
  const container = document.getElementById('news-container');
  try {
    const res = await fetch(`${CONNECTORS_API_BASE}/api/connectors/news`);
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<p class="indicator-explain">Nenhuma notícia relevante nas últimas 2 horas.</p>';
      return;
    }
    container.innerHTML = data.items.map((item, i) => `
      <div class="news-item">
        <div class="news-title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></div>
        <div class="news-meta">
          <span class="badge ${item.sentiment === 'BULLISH' ? 'buy' : item.sentiment === 'BEARISH' ? 'sell' : 'neutral'}">${item.sentiment}</span>
          <button class="ask-claude-btn" data-idx="${i}">Perguntar à IA</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.ask-claude-btn').forEach((btn) => {
      btn.addEventListener('click', () => askChatAboutNews(data.items[parseInt(btn.dataset.idx, 10)]));
    });
  } catch (err) {
    container.innerHTML = `<p class="indicator-explain">Feed de notícias indisponível: ${err.message}</p>`;
  }
}

async function loadTrendspiderPanel() {
  const configRes = await fetch(`${CONNECTORS_API_BASE}/api/trendspider/config`);
  const config = await configRes.json();
  document.getElementById('trendspider-url').value = config.url || '';
  document.getElementById('trendspider-enabled').checked = !!config.enabled;
  await refreshTrendspiderLog();
}

async function refreshTrendspiderLog() {
  const res = await fetch(`${CONNECTORS_API_BASE}/api/trendspider/log`);
  const data = await res.json();
  const container = document.getElementById('trendspider-log');
  if (!data.log || data.log.length === 0) {
    container.innerHTML = '<p class="indicator-explain">Sem mensagens ainda.</p>';
    return;
  }
  container.innerHTML = data.log.slice(0, 10).map((entry) => `
    <div class="ts-log-item">
      <span class="badge ${entry.direction === 'inbound' ? 'neutral' : 'buy'}">${entry.direction}</span>
      <span class="indicator-explain">${new Date(entry.timestamp).toLocaleTimeString('pt-BR')} — ${JSON.stringify(entry.payload).slice(0, 80)}</span>
    </div>
  `).join('');
}

function initTrendspiderControls() {
  document.getElementById('trendspider-save').addEventListener('click', async () => {
    const url = document.getElementById('trendspider-url').value.trim();
    const enabled = document.getElementById('trendspider-enabled').checked;
    await fetch(`${CONNECTORS_API_BASE}/api/trendspider/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, enabled }),
    });
  });

  document.getElementById('trendspider-test').addEventListener('click', async () => {
    const res = await fetch(`${CONNECTORS_API_BASE}/api/trendspider/test`, { method: 'POST' });
    const data = await res.json();
    showToast(data.ok ? 'Conexão TrendSpider OK' : `Falha: ${data.reason || data.status}`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTrendspiderControls();
  loadDanelfinPanel();
  loadIntelligencePanel();
  loadNewsFeed();
  loadTrendspiderPanel();

  setInterval(loadDanelfinPanel, 60 * 60 * 1000);
  setInterval(loadIntelligencePanel, 60 * 60 * 1000);
  setInterval(loadNewsFeed, 5 * 60 * 1000);
  setInterval(refreshTrendspiderLog, 30 * 1000);
});
