// MarketDesk AI chat: builds the market-aware system prompt, exposes the
// tool definitions (OpenAI-style, used by Workers AI function calling), runs
// the tool-use loop (non-streaming calls until the model stops calling
// tools), then streams the final answer back to the browser via SSE.
//
// Runs on Cloudflare Workers AI (binding `env.AI`) instead of a paid
// third-party API key, so no ANTHROPIC_API_KEY is required to deploy.

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TOOL_ITERATIONS = 3;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_current_price',
      description: 'Retorna preço atual e indicadores técnicos do ativo (RSI, MACD, Bollinger, ATR, volume, padrão de candle).',
      parameters: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'ex: BTCUSDT' } },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_danelfin_score',
      description: 'Retorna AI Score Danelfin (1-10) para uma ação correlata ao Bitcoin (ex: MSTR, COIN, MARA, RIOT, IBIT). Não cobre criptomoedas diretamente.',
      parameters: {
        type: 'object',
        properties: { ticker: { type: 'string', description: 'ex: MSTR, COIN' } },
        required: ['ticker'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fear_greed',
      description: 'Retorna o índice Fear & Greed atual do mercado cripto (0-100).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_price_prediction',
      description: 'Retorna a previsão de range de preço para o intervalo dado.',
      parameters: {
        type: 'object',
        properties: { interval: { type: 'string', enum: ['15min', '1h', '4h'] } },
        required: ['interval'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_support_resistance',
      description: 'Retorna os níveis de suporte e resistência (pivot points) calculados para o ativo selecionado.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_news',
      description: 'Retorna as últimas notícias relevantes do mercado cripto, com classificação de sentimento.',
      parameters: {
        type: 'object',
        properties: { asset: { type: 'string', description: 'ex: bitcoin, ethereum (opcional)' } },
      },
    },
  },
];

export function buildSystemPrompt(snapshot) {
  return `Você é MarketDesk AI, um analista técnico educacional especializado em criptomoedas e mercados financeiros.
Sua função é EXPLICAR análises, ENSINAR conceitos de mercado e CONTEXTUALIZAR movimentos de preço.

REGRA ABSOLUTA: Nunca forneça conselho financeiro direto. Use linguagem como "o indicador sugere", "tecnicamente aponta para", "historicamente este padrão indica". Sempre encerre análises de mercado com: "Esta é uma análise técnica educacional. Não constitui recomendação de investimento."

Você tem acesso a ferramentas (tools) para consultar dados em tempo real. Use-as sempre que precisar de números atualizados em vez de inventar valores. Referencie os dados do snapshot ou das tools nas suas respostas.

SNAPSHOT ATUAL DO MERCADO (${snapshot.selectedAsset}):
- Preço: $${snapshot.currentPrice} (${snapshot.change24h}% / 24h)
- RSI(14): ${snapshot.rsi} — ${snapshot.rsiZone}
- MACD: ${snapshot.macdSignal}
- Volume atual vs média: ${snapshot.volumeRatio}x
- Padrão detectado: ${snapshot.candlePattern}
- Suporte mais próximo: $${snapshot.s1}
- Resistência mais próxima: $${snapshot.r1}
- Previsão 15min: $${snapshot.range15Low} – $${snapshot.range15High}
- Previsão 1h: $${snapshot.range1hLow} – $${snapshot.range1hHigh}
- Sentimento: ${snapshot.marketBias}
- Ativo selecionado: ${snapshot.selectedAsset}`;
}

export function buildSnapshot(indicators, predictions, symbol) {
  const rsi = indicators.rsi.value;
  const rsiZone = rsi > 70 ? 'sobrecompra' : rsi < 30 ? 'sobrevenda' : 'neutro';
  return {
    currentPrice: indicators.price.toFixed(2),
    change24h: '—',
    rsi,
    rsiZone,
    macdSignal: indicators.macd.status,
    volumeRatio: indicators.volume.ratio,
    candlePattern: indicators.pattern.name,
    s1: indicators.pivots.s1.toFixed(2),
    r1: indicators.pivots.r1.toFixed(2),
    range15Low: predictions.fifteenMin.range_low,
    range15High: predictions.fifteenMin.range_high,
    range1hLow: predictions.oneHour.range_low,
    range1hHigh: predictions.oneHour.range_high,
    marketBias: predictions.fifteenMin.bias,
    selectedAsset: symbol,
  };
}

// Runs the tool-use loop (non-streaming) and returns the final {messages}
// ready for a streaming call, plus the tool-call trace (for debugging/UI highlight hints).
export async function resolveToolUse({ ai, system, messages, toolExecutors }) {
  let currentMessages = [{ role: 'system', content: system }, ...messages];
  const toolTrace = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await ai.run(MODEL, {
      messages: currentMessages,
      tools: TOOLS,
      max_tokens: 1024,
    });

    const toolCalls = result.tool_calls || [];
    if (toolCalls.length === 0) {
      return { messages: currentMessages, lastAssistantContent: result.response, toolTrace };
    }

    currentMessages.push({ role: 'assistant', content: result.response || '', tool_calls: toolCalls });

    for (const call of toolCalls) {
      const input = call.arguments || {};
      toolTrace.push({ name: call.name, input });
      let toolResult;
      try {
        toolResult = await toolExecutors[call.name]?.(input);
      } catch (err) {
        toolResult = { error: err.message };
      }
      currentMessages.push({
        role: 'tool',
        name: call.name,
        content: JSON.stringify(toolResult ?? { error: 'tool não implementada' }),
      });
    }
  }

  return { messages: currentMessages, lastAssistantContent: null, toolTrace };
}

// Streams the final answer from Workers AI and re-emits it through `onChunk`
// using the same `content_block_delta` / `text_delta` envelope the frontend
// already parses, so the SSE consumer (frontend/js/chat.js) needs no changes.
export async function streamFinalAnswer({ ai, system, messages, onChunk }) {
  const fullMessages = messages[0]?.role === 'system' ? messages : [{ role: 'system', content: system }, ...messages];

  const stream = await ai.run(MODEL, {
    messages: fullMessages,
    max_tokens: 1024,
    stream: true,
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const text = parsed.response;
        if (text) {
          onChunk(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`);
        }
      } catch {
        // ignore malformed keepalive chunks
      }
    }
  }
}
