function quickChips() {
  return ['chip1', 'chip2', 'chip3', 'chip4', 'chip5', 'chip6'].map((k) => t(k));
}

let chatHistory = [];

function renderChatChips() {
  const container = document.getElementById('chat-chips');
  container.innerHTML = quickChips().map((c) => `<button class="chat-chip">${c}</button>`).join('');
  container.querySelectorAll('.chat-chip').forEach((btn) => {
    btn.addEventListener('click', () => sendChatMessage(btn.textContent));
  });
}

function appendChatMessage(role, text) {
  const log = document.getElementById('chat-log');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  const locale = window.LANG === 'pt' ? 'pt-BR' : 'en-US';
  const time = new Date().toLocaleTimeString(locale);
  el.innerHTML = `
    <div class="chat-msg-header">
      <span>${role === 'user' ? t('chatYou') : t('chatAI')}</span>
      ${role === 'assistant' ? `<span class="badge neutral">${t('chatBadge')}</span>` : ''}
      <span class="chat-time">${time}</span>
    </div>
    <div class="chat-msg-body">${escapeHtml(text)}</div>
    ${role === 'assistant' ? `<button class="chat-copy-btn">${t('chatCopy')}</button>` : ''}
  `;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;

  if (role === 'assistant') {
    el.querySelector('.chat-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(el.querySelector('.chat-msg-body').textContent);
    });
  }
  return el.querySelector('.chat-msg-body');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setTypingIndicator(visible) {
  document.getElementById('chat-typing').style.display = visible ? 'block' : 'none';
}

function highlightIndicatorsMentioned(text) {
  const map = { RSI: 'rsi', MACD: 'macd', Bollinger: 'bollinger', ATR: 'atr', volume: 'volume' };
  Object.entries(map).forEach(([keyword]) => {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      document.querySelectorAll('.indicator-name').forEach((row) => {
        if (row.textContent.toLowerCase().includes(keyword.toLowerCase())) {
          const parentRow = row.closest('.indicator-row');
          if (parentRow) {
            parentRow.style.outline = '1px solid #00c896';
            setTimeout(() => { parentRow.style.outline = 'none'; }, 2500);
          }
        }
      });
    }
  });
}

async function sendChatMessage(text) {
  const input = document.getElementById('chat-input');
  const message = (text || input.value).trim();
  if (!message) return;
  input.value = '';

  appendChatMessage('user', message);
  chatHistory.push({ role: 'user', content: message });
  setTypingIndicator(true);

  const bodyEl = appendChatMessage('assistant', '');
  let fullText = '';

  try {
    const res = await fetch(`${window.MARKETDESK_CONFIG.API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory, symbol: window.activeSymbol || 'BTCUSDT' }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: t('chatConnectErr') + res.status }));
      bodyEl.textContent = err.error || t('chatConnectErr') + res.status;
      setTypingIndicator(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); continue; }
        if (line.startsWith('data: ')) {
          if (currentEvent === 'tool_trace') continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              fullText += evt.delta.text;
              bodyEl.textContent = fullText;
              document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
            }
          } catch { /* keepalive */ }
        }
      }
    }

    chatHistory.push({ role: 'assistant', content: fullText });
    highlightIndicatorsMentioned(fullText);
  } catch (err) {
    bodyEl.textContent = t('chatConnectErr') + err.message;
  } finally {
    setTypingIndicator(false);
  }
}

function askChatAboutNews(item) {
  const prompt = window.LANG === 'pt'
    ? `Pode comentar esta notícia? "${item.title}" (${item.source})`
    : `Can you comment on this news? "${item.title}" (${item.source})`;
  document.getElementById('chat-input').value = prompt;
  sendChatMessage();
}

function initChat() {
  renderChatChips();
  document.getElementById('chat-send').addEventListener('click', () => sendChatMessage());
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
}

document.addEventListener('DOMContentLoaded', initChat);
