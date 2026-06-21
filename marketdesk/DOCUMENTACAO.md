# MarketDesk — Documentação Técnica

> Referência da arquitetura atual. O histórico completo de commits e decisões
> anteriores pode ser consultado via `git log`.

---

## 1. Visão geral

**MarketDesk** é uma mesa de análise financeira **educacional** em tempo real,
focada em BTC, ETH, SOL, BNB e XRP. Exibe candlesticks, indicadores técnicos
(RSI, MACD, Bollinger, ATR, padrões de vela), Market Structure Score (−5 a +5),
previsões de range (15min/1h/diário orientadas ao Kalshi), conectores de decisão
bull/bear, log retrospectivo de acurácia, inteligência externa (Fear & Greed,
sentimento, on-chain) e feed de notícias RSS.

⚠️ **Não constitui aconselhamento financeiro.**

**Deploy ativo:** Cloudflare Workers em `https://oremetfintech.demestritech-com.workers.dev`

---

## 2. Estrutura de pastas

```
marketdesk/
├── README.md                  # guia de deploy
├── DOCUMENTACAO.md            # este arquivo
├── package.json               # raiz: script de testes
├── tests/
│   ├── analysis.test.js       # 18 testes: RSI, MACD, ATR, Bollinger, volume, padrões, pivots
│   ├── predictions.test.js    # 5 testes: engine de previsão de range
│   └── connectors.test.js     # 4 testes: degradação graciosa dos conectores externos
│
├── cloudflare/                # ===== Deploy ativo =====
│   ├── wrangler.toml          # config do Worker: bindings, KV, cron, assets
│   ├── package.json           # scripts: dev / deploy / sync-assets
│   ├── public/                # cópia committed de ../frontend (servida pelo Worker via [assets])
│   │   ├── index.html
│   │   ├── css/desk.css
│   │   └── js/
│   │       ├── app.js         # controller: ticker, REST loaders, WebSocket, alertas
│   │       ├── chart.js       # wrapper LightweightCharts: candles + volume + EMA9/21/SMA50
│   │       ├── indicators.js  # renderiza indicadores, S/R e Market Structure
│   │       ├── predictions.js # renderiza previsões de range e histórico
│   │       ├── glossary.js    # tooltips educacionais dos indicadores
│   │       ├── connectors.js  # painéis de inteligência externa e notícias
│   │       └── i18n.js        # EN/PT-BR: t(), setLang(), applyStaticI18n()
│   └── src/
│       ├── index.js           # roteador do Worker + cron handler
│       ├── analysis.js        # indicadores técnicos + Market Structure
│       ├── predictions.js     # engine de previsão de range (15min/1h/daily)
│       ├── binance.js         # multi-exchange client com fallback e cache
│       ├── websocket.js       # Durable Object MarketHub: relay WS
│       └── connectors.js      # Fear&Greed, CoinGecko, Glassnode, RSS news
│
├── frontend/                  # cópia de trabalho do frontend
│   └── ...                    # sincronizar com `npm run sync-assets` antes do deploy
│
└── _archive/oracle/           # Backend Node.js/Express — ARQUIVADO, não usado no deploy
    └── ...                    # mantido para referência histórica
```

---

## 3. Backend Cloudflare (`cloudflare/src/`)

### `index.js` — roteador principal

Rotas ativas:

| Rota | Descrição |
|---|---|
| `GET /api/symbols` | Lista de símbolos suportados |
| `GET /api/tickers` | Preço e variação 24h de todos os símbolos |
| `GET /api/candles?symbol&interval&limit` | Candles OHLCV + campo `source` (exchange usada) |
| `GET /api/analysis?symbol&interval&lang` | Indicadores técnicos completos incluindo Market Structure |
| `GET /api/predictions?symbol&lang` | Previsões de range 15min/1h/daily |
| `GET /api/history?symbol` | Log retrospectivo de acurácia (KV) |
| `GET /api/connectors/intelligence` | Fear&Greed + CoinGecko + Glassnode |
| `GET /api/connectors/news` | Feed de notícias RSS classificado |
| `GET /ws` | WebSocket relay (delega ao Durable Object MarketHub) |

Cron `*/15 * * * *`: recalcula previsões e persiste log no KV.

### `analysis.js` — indicadores técnicos

Exporta: `calculateRSI`, `calculateMACD`, `calculateBollinger`, `calculateATR`,
`volumeRatio`, `detectCandlePattern`, `calculatePivotPoints`, `buildIndicatorPanel`,
`detectMarketStructure`, `sma`, `ema`, `round`.

`detectMarketStructure(candles, pivots, atr, lang)`: verifica os 4 níveis de
pivot (R2/R1/S1/S2) em uma janela de 10 candles usando tolerância `atr × 0.15`.
Classifica 8 padrões (break, retest, false-break × suporte/resistência). Score
−5 a +5 com contribuições de volume (+1), fundos ascendentes (+1), topos
descendentes (−1). Retorna `{ score, bias, primaryEvent, events, scoreBreakdown, message }`.

`buildIndicatorPanel(candles, lang)`: agrega todos os indicadores em um objeto
único consumido pelo frontend.

### `predictions.js` — engine de previsão de range

`predictRange(candles, interval, lang)`: calcula range usando ATR × multiplicador
do intervalo, ajustado por RSI/MACD (momentum), volume e proximidade de S/R.
Confiança 20–95% por confluência de sinais. Para `interval='daily'` inclui
`kalshiTarget` (preço-alvo escalado até 17h ET) e `hoursUntil5pmET` para
orientação no mercado Kalshi.

Sempre chamado com candles de 1m para manter granularidade operacional.

### `binance.js` — multi-exchange client

`fetchKlines(symbol, interval, limit)` → `{ candles, source }`:

Fallback por ordem: **Coinbase → Binance → Binance.US → Kraken → CoinGecko**.
Coinbase e Kraken têm prioridade porque Binance bloqueia IPs de cloud (HTTP 451/403).
Cache em memória de 5s, throttle mínimo de 120ms entre requisições.

### `websocket.js` — Durable Object MarketHub

Relay do stream de ticker Coinbase → Kraken (fallback) para os 5 símbolos ativos.
Monta candles de 1m a partir de eventos de ticker (`last_size` para volume real).
Reconecta com backoff exponencial 1s → 30s. Distribui via broadcast para todos
os clientes WebSocket conectados.

### `connectors.js` — integrações externas

Todas degradam graciosamente (retornam `{ error }` sem quebrar o painel):

| Função | Fonte | Chave |
|---|---|---|
| `getFearGreedIndex` | Alternative.me | Pública |
| `getCoinGeckoSentiment` | CoinGecko | Pública |
| `getOnChainPanel` | Glassnode | `GLASSNODE_API_KEY` (opcional) |
| `getMessariMetrics` | Messari | Pública (reservado) |
| `getMarketNews` | RSS CoinDesk/Cointelegraph/CryptoNews | Pública |

---

## 4. Frontend (`cloudflare/public/js/`)

### `app.js`

Controller principal. Gerencia:
- Ticker bar (polling REST a cada 5s + atualização via WebSocket)
- `loadAll()`: `loadCandles` + `loadAnalysis` + `loadPredictions` + `loadHistory`
- WebSocket com reconexão exponencial; só atualiza o último candle no gráfico quando `activeTimeframe === '1m'`
- Exibe `source` (exchange) recebida de `/api/candles` discretamente no cabeçalho do gráfico

### `chart.js`

Classe `MarketChart`: LightweightCharts v4.2.3 com:
- Timezone UTC−4 (EDT) aplicado via offset nos timestamps
- Tema terminal: `#050e1a` bg, `#33FF77` texto, `#00E676`/`#FF1744` candles
- `fitContent()` chamado após cada `setCandles()` para enquadrar todos os candles
- `autoSize: true` para responsividade automática
- Séries: candlestick + volume (histograma) + EMA9 (dourado) + EMA21 (azul) + SMA50 (creme)

### `i18n.js`

`window.LANG` padrão `'en'`, persistido em `localStorage('md_lang')`.
`t(key)`, `setLang(lang)`, `applyStaticI18n()`. Backend recebe `&lang=` em
`/api/analysis` e `/api/predictions` para gerar textos no idioma correto.

### Layout responsivo

| Breakpoint | Layout |
|---|---|
| > 1100px | 3 colunas: gráfico (2.2fr) + indicadores (1fr) + conectores (1fr) |
| 769–1100px | 2 colunas: gráfico full-width (topo) + indicadores/conectores lado a lado |
| < 768px | 1 coluna: Chart → Previsões → Indicadores → S/R → Market Structure → Notícias |

Altura do gráfico: `clamp(320px, 52vh, 620px)`.

---

## 5. Testes

Todos importam de `cloudflare/src/` (não do oracle arquivado):

```bash
node --test tests/analysis.test.js tests/predictions.test.js tests/connectors.test.js
# 27 testes passando
```

| Arquivo | Qtd | Cobre |
|---|---|---|
| `analysis.test.js` | 18 | RSI, MACD, ATR, Bollinger, volume ratio, padrões de candle, pivot points, sma/ema |
| `predictions.test.js` | 5 | formato de saída, range 15min < 1h, viés em tendência, exemplo BTC |
| `connectors.test.js` | 4 | degradação graciosa: FearGreed, CoinGecko, Glassnode sem chave, shape de getExternalIntelligence |

---

## 6. Variáveis de ambiente

| Variável | Obrigatória? | Propósito |
|---|---|---|
| `GLASSNODE_API_KEY` | Não | Métricas on-chain (free tier disponível) |
| `MESSARI_API_KEY` | Não | Reservado para uso futuro |
| `CRYPTOQUANT_WEBHOOK_SECRET` | Não | Reservado para validação de webhooks |

Nenhuma chave é necessária para o funcionamento básico. Dados de mercado
(Coinbase, Kraken, CoinGecko) são públicos. Workers AI (`[ai]` binding) está
configurado no `wrangler.toml` mas não é usado atualmente (reservado).

---

## 7. Sincronização frontend

`cloudflare/public/` é uma cópia committed de `../frontend`. Editar sempre em
`frontend/`, depois sincronizar:

```bash
cd marketdesk/cloudflare
npm run sync-assets   # copia ../frontend -> public/
git add public
```

O script `sync-assets` já roda automaticamente antes de `dev` e `deploy`.

---

## 8. Archive Oracle

`_archive/oracle/` contém o backend Node.js/Express original (Express + ws +
SQLite + PM2 + Nginx). **Não está no deploy ativo.** Mantido como referência
histórica para quem quiser rodar em uma VM tradicional (ex.: OCI Free Tier,
Ampere A1).
