// MarketDesk AI chat: builds the market-aware system prompt, exposes the
// Anthropic tool definitions, runs the tool-use loop (non-streaming calls
// until Claude is done calling tools), then streams the final answer back
// to the browser via SSE (passthrough of Anthropic's stream events).

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 3;

export const TOOLS = [
  {
    name: 'get_current_price',
    description: 'Retorna preço atual e indicadores técnicos do ativo (RSI, MACD, Bollinger, ATR, volume, padrão de candle).',
    input_schema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'ex: BTCUSDT' } },
      required: ['symbol'],
    },
  },
  {
    name: 'get_danelfin_score',
    description: 'Retorna AI Score Danelfin (1-10) para uma ação correlata ao Bitcoin (ex: MSTR, COIN, MARA, RIOT, IBIT). Não cobre criptomoedas diretamente.',
    input_schema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'ex: MSTR, COIN' } },
      required: ['ticker'],
    },
  },
  {
    name: 'get_fear_greed',
    description: 'Retorna o índice Fear & Greed atual do mercado cripto (0-100).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_price_prediction',
    description: 'Retorna a previsão de range de preço para o intervalo dado.',
    input_schema: {
      type: 'object',
      properties: { interval: { type: 'string', enum: ['15min', '1h', '4h'] } },
      required: ['interval'],
    },
  },
  {
    name: 'get_support_resistance',
    description: 'Retorna os níveis de suporte e resistência (pivot points) calculados para o ativo selecionado.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_recent_news',
    description: 'Retorna as últimas notícias relevantes do mercado cripto, com classificação de sentimento.',
    input_schema: {
      type: 'object',
      properties: { asset: { type: 'string', description: 'ex: bitcoin, ethereum (opcional)' } },
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

async function callAnthropic(apiKey, body) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API HTTP ${res.status}: ${text}`);
  }
  return res;
}

// Runs the tool-use loop (non-streaming) and returns the final {system, messages}
// ready for a streaming call, plus the tool-call trace (for debugging/UI highlight hints).
export async function resolveToolUse({ apiKey, system, messages, toolExecutors }) {
  let currentMessages = messages.slice();
  const toolTrace = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await callAnthropic(apiKey, {
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: currentMessages,
      tools: TOOLS,
    });
    const data = await res.json();

    if (data.stop_reason !== 'tool_use') {
      return { messages: currentMessages, lastAssistantContent: data.content, toolTrace };
    }

    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');
    currentMessages.push({ role: 'assistant', content: data.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      toolTrace.push({ name: block.name, input: block.input });
      let result;
      try {
        result = await toolExecutors[block.name]?.(block.input || {});
      } catch (err) {
        result = { error: err.message };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result ?? { error: 'tool não implementada' }),
      });
    }
    currentMessages.push({ role: 'user', content: toolResults });
  }

  return { messages: currentMessages, lastAssistantContent: null, toolTrace };
}

export async function streamFinalAnswer({ apiKey, system, messages, onChunk }) {
  const res = await callAnthropic(apiKey, {
    model: MODEL,
    max_tokens: 1024,
    system,
    messages,
    stream: true,
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      onChunk(line);
    }
  }
}
