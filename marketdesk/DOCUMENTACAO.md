# MarketDesk — Documentação Técnica do Projeto

> Documento gerado para consolidar **todo o histórico de desenvolvimento**: estrutura de pastas, propósito de cada arquivo, histórico de commits e decisões/correções tomadas ao longo do projeto.

---

## 1. Visão geral

**MarketDesk** é uma mesa de análise financeira **educacional** em tempo real, focada em Bitcoin e principais criptomoedas (BTC, ETH, SOL, BNB, XRP). Exibe candlesticks, indicadores técnicos, previsões de range de preço (15min/1h), conectores de decisão (bull/bear), um log retrospectivo de acurácia, chat com IA e integrações externas (Danelfin, TrendSpider, notícias, Fear & Greed, on-chain).

⚠️ **Não constitui aconselhamento financeiro.** Toda a lógica de "previsão" é baseada em análise técnica histórica (RSI, MACD, Bollinger, ATR, candles, pivots) e é explicitamente rotulada como educacional em toda a interface.

O repositório foi desenhado para suportar **dois backends intercambiáveis** — você escolhe um:

| Opção | Stack | Quando usar |
|---|---|---|
| **A — Cloudflare Workers** | Workers + Durable Objects + KV + Workers AI | Deploy sem servidor, escala automática, zero manutenção de infra |
| **B — Oracle Cloud (OCI Free Tier)** | Node.js/Express + `ws` + SQLite + PM2 + Nginx | Controle total de VM, ARM Ampere A1 grátis, persistência em disco |

O **frontend é o mesmo** para ambos: HTML/CSS/JS puro (sem framework/bundler), servido pelo próprio backend escolhido.

---

## 2. Estrutura de pastas

```
marketdesk/
├── DOCUMENTACAO.md          # este arquivo
├── README.md                # guia de deploy passo-a-passo (PT-BR)
├── package.json             # raiz: roda a suíte de testes (node --test)
├── tests/                   # testes unitários (Node.js test runner nativo)
│   ├── analysis.test.js     # 18 testes: RSI, MACD, ATR, Bollinger, volume, padrões, pivots
│   └── predictions.test.js  # 5 testes: engine de previsão de range (com exemplo BTC)
│
├── cloudflare/               # ===== Backend Opção A =====
│   ├── wrangler.toml         # config do Worker: bindings, KV, cron, assets, Workers AI
│   ├── package.json          # scripts (dev/deploy/sync-assets) + devDependency wrangler
│   ├── public/                # CÓPIA committed de ../frontend (ver seção 4.3)
│   │   ├── index.html
│   │   ├── css/desk.css
│   │   └── js/*.js
│   └── src/
│       ├── index.js          # entry point do Worker: roteamento HTTP + cron handler
│       ├── analysis.js       # indicadores técnicos (RSI, MACD, Bollinger, ATR, padrões, pivots)
│       ├── predictions.js    # engine de previsão de range (15min/1h)
│       ├── binance.js        # cliente REST Binance com cache + throttle + fallback CoinGecko
│       ├── websocket.js      # Durable Object `MarketHub`: relay WS com reconexão
│       ├── chat.js           # chat de IA: tools, prompt, loop de tool-use, streaming SSE
│       ├── connectors.js     # Danelfin, Fear&Greed, CoinGecko, Glassnode, Messari, RSS news
│       └── trendspider.js    # bridge de webhook bidirecional com TrendSpider (KV-backed)
│
├── oracle/                   # ===== Backend Opção B =====
│   ├── setup.sh               # script de provisionamento Ubuntu 22.04 ARM (Ampere A1)
│   ├── nginx.conf             # reverse proxy (porta 80 → 8080, suporte a WS)
│   ├── ecosystem.config.cjs   # config do PM2 (processo + env vars)
│   ├── package.json           # deps: express, ws, better-sqlite3
│   ├── server.js              # servidor Express + WS: mesmas rotas do Worker
│   ├── db.js                  # schema SQLite (better-sqlite3) para log de previsões
│   ├── analysis.js            # cópia idêntica de cloudflare/src/analysis.js
│   ├── predictions.js         # cópia idêntica de cloudflare/src/predictions.js
│   ├── chat.js                # chat de IA via Anthropic API (Claude) — versão Node
│   ├── connectors.js          # cópia idêntica de cloudflare/src/connectors.js
│   └── trendspider.js         # versão em memória (módulo Node de longa duração)
│
└── frontend/                  # ===== Frontend único (serve qualquer backend) =====
    ├── index.html              # estrutura da SPA: gráfico, painéis, chat, conectores
    ├── css/
    │   └── desk.css             # tema dark financeiro (cores, grid, componentes)
    └── js/
        ├── app.js                # controller principal: ticker bar, REST loaders, WS, alerts
        ├── chart.js               # wrapper de Lightweight Charts (candles + volume + EMAs)
        ├── indicators.js          # renderização do painel de indicadores e S/R
        ├── predictions.js         # renderização de previsões, conectores e histórico
        ├── glossary.js            # tooltips explicativos de cada indicador (educacional)
        ├── chat.js                # painel de chat: SSE parsing, chips, highlight de indicadores
        └── connectors.js          # painéis de Danelfin, inteligência externa, notícias, TrendSpider
```

---

## 3. Detalhamento por arquivo

### 3.1 Backend Cloudflare (`cloudflare/`)

- **`wrangler.toml`** — arquivo central de configuração do Worker. Define:
  - `name = "oremetfintech"` — precisa bater com o nome do projeto conectado no dashboard Cloudflare (Workers Builds via Git), senão a CI emite um aviso de "Worker name mismatch" e sobrescreve.
  - `[assets]` — serve o frontend estático (`public/`) direto do Worker, com `run_worker_first = true` (o `fetch()` do Worker roda primeiro; rotas não-API caem no binding `ASSETS`).
  - `[[durable_objects.bindings]]` + `[[migrations]]` — registra a classe `MarketHub` como Durable Object, usando `new_sqlite_classes` (obrigatório no plano free — ver seção 5).
  - `[[kv_namespaces]]` — namespace `MARKET_KV` para cache do log de previsões (24 entradas por símbolo).
  - `[ai]` — binding nativo do **Workers AI** (`env.AI`), usado pelo chat (ver seção 3.1 chat.js).
  - `[triggers]` — cron `*/15 * * * *` para recálculo periódico de previsões e alertas.
  - `[vars]` — variáveis não-secretas (`ENVIRONMENT`).

- **`package.json`** — scripts `dev`/`deploy` rodam `sync-assets` antes (copia `../frontend` → `public/`), `tail` para live logs.

- **`src/index.js`** — roteador principal do Worker (`fetch()`):
  - `/ws` → delega ao Durable Object `MarketHub`.
  - `/api/symbols`, `/api/tickers`, `/api/candles`, `/api/analysis`, `/api/predictions`, `/api/history` → dados de mercado.
  - `/api/connectors/*` → Danelfin, Fear&Greed, intelligence, news.
  - `/webhooks/trendspider` + `/api/trendspider/*` → bridge TrendSpider.
  - `/api/chat` → chat de IA (`handleChat`).
  - fallback final → `env.ASSETS.fetch(request)` (serve o frontend estático).
  - `scheduled()` → cron handler: recalcula previsões e dispara alertas para TrendSpider quando detecta padrão de candle não-neutro.

- **`src/analysis.js`** — biblioteca pura de indicadores técnicos: `calculateRSI`, `calculateMACD`, `calculateBollinger`, `calculateATR`, `volumeRatio`, `detectCandlePattern` (Doji, Hammer, Shooting Star, Engulfing, Morning/Evening Star), `calculatePivotPoints` (S1/S2/R1/R2 clássicos), `buildIndicatorPanel` (agrega tudo num único objeto consumido pelo frontend e pelas tools do chat).

- **`src/predictions.js`** — `predictRange(candles, interval)`: calcula range de preço esperado usando volatilidade (ATR × multiplicador do intervalo), momentum (RSI+MACD), viés de volume, ajuste por S/R, e gera confiança (20-95%) por confluência de sinais. Inclui `buildExplanation` que gera o texto educacional em português.

- **`src/binance.js`** — `fetchKlines`/`fetch24hTicker` com cache em memória (mín. 5s) e throttle (mín. 120ms entre requisições), fallback automático para CoinGecko se a Binance estiver inacessível.

- **`src/websocket.js`** — Durable Object `MarketHub`: mantém conexões WS dos clientes do frontend, relay do stream combinado da Binance (`@kline_1m` para todos os símbolos), reconexão com backoff exponencial (1s → 30s), e um canal interno de broadcast via POST (usado para notificar eventos do TrendSpider em tempo real).

- **`src/chat.js`** — **módulo de IA do chat**, atualmente rodando em **Cloudflare Workers AI** (não Anthropic — ver seção 6):
  - `TOOLS` — 6 ferramentas em formato OpenAI/function-calling: `get_current_price`, `get_danelfin_score`, `get_fear_greed`, `get_price_prediction`, `get_support_resistance`, `get_recent_news`.
  - `buildSystemPrompt`/`buildSnapshot` — injeta um snapshot do mercado atual (preço, RSI, MACD, volume, padrão, S/R, previsões) no prompt do sistema a cada mensagem.
  - `resolveToolUse` — loop de até 3 iterações chamando `env.AI.run()` com o modelo `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, executando as tools localmente e devolvendo o resultado ao modelo.
  - `streamFinalAnswer` — chama o modelo em modo streaming e reemite os chunks como eventos SSE (`content_block_delta`/`text_delta`) — formato mantido de propósito para o frontend não precisar de nenhuma mudança.

- **`src/connectors.js`** — integrações externas, todas com **degradação graciosa** (retornam `{error: msg}` sem quebrar o painel se a chave não estiver configurada):
  - `getDanelfinPanel`/`getDanelfinScore` — AI Score (1-10) para ações correlatas ao BTC (MSTR, COIN, MARA, RIOT, IBIT). Requer `DANELFIN_API_KEY` (pago).
  - `getFearGreedIndex` — índice Fear & Greed (Alternative.me, gratuito).
  - `getCoinGeckoSentiment` — sentimento social/dev (CoinGecko, gratuito).
  - `getGlassnodeMetric`/`getOnChainPanel` — métricas on-chain (Glassnode, requer `GLASSNODE_API_KEY`, free tier disponível).
  - `getMessariMetrics` — implementado para uso futuro via tool use (Messari, gratuito).
  - `getMarketNews` — agrega RSS de CoinDesk/Cointelegraph/CryptoNews, filtra por keyword e classifica localmente como BULLISH/BEARISH/NEUTRO.

- **`src/trendspider.js`** — bridge bidirecional com TrendSpider (que não tem API pública de dados, só webhooks):
  - Recebe alertas via `/webhooks/trendspider` (configurado no painel do TrendSpider).
  - Envia alertas para a URL de webhook configurada pelo usuário via UI (painel "TrendSpider Webhook"), com toggle de ativação e teste de conexão.
  - Estado persistido em **KV** (já que Workers são stateless entre invocações).

### 3.2 Backend Oracle (`oracle/`)

Réplica funcional do backend Cloudflare para ambientes que preferem uma VM tradicional:

- **`setup.sh`** — script de provisionamento para Ubuntu 22.04 ARM (Ampere A1, OCI Free Tier): atualiza o sistema, instala build tools (necessários para compilar `better-sqlite3` nativamente em ARM), Node.js 20, PM2, Nginx; instala dependências (`npm install`); configura Nginx como reverse proxy; inicia via PM2 com `pm2 startup` para restart automático após reboot.
- **`nginx.conf`** — proxy reverso da porta 80 (e 443 com Certbot) para o processo Node na porta 8080, com upgrade de headers para WebSocket.
- **`ecosystem.config.cjs`** — config do PM2 (extensão `.cjs` necessária porque o `package.json` declara `"type": "module"`, e PM2 usa `module.exports` CommonJS).
- **`db.js`** — schema SQLite (`better-sqlite3`) para persistir o log de previsões em disco (equivalente ao KV do Cloudflare).
- **`server.js`** — servidor Express + `ws`, espelhando as mesmas rotas do `index.js` do Worker; usa `setInterval` para o job periódico de 15min (em vez de Cron Trigger).
- **`chat.js`** — versão Node do chat, **ainda usando a API da Anthropic** (Claude `claude-sonnet-4-6`) — diferente do Cloudflare, porque o binding `env.AI` (Workers AI) só existe dentro do runtime de Workers. Requer `ANTHROPIC_API_KEY`.
- **`analysis.js`, `predictions.js`, `connectors.js`** — cópias idênticas em lógica às versões Cloudflare.
- **`trendspider.js`** — versão em memória (módulo Node de processo longo, não precisa de KV).

### 3.3 Frontend (`frontend/`)

- **`index.html`** — estrutura única da SPA: ticker bar, gráfico Lightweight Charts, painel de indicadores, painel de S/R, conectores de decisão (bull/bear), previsões 15min/1h, log retrospectivo, painéis de Danelfin/inteligência externa/notícias/TrendSpider, e o painel de chat. Usa `window.MARKETDESK_CONFIG = { API_BASE: window.location.origin, ... }` — aponta automaticamente para o próprio host, sem configuração manual.
- **`css/desk.css`** — tema dark financeiro: `--bg: #0d0d0f`, `--surface: #161618`, `--card: #1e1e21`, `--bull: #00c896`, `--bear: #ff4757`, fontes JetBrains Mono (números) + Inter (texto), sem gradientes/sombras, bordas 1px `rgba(255,255,255,0.08)`.
- **`js/app.js`** — controller principal: carrega tickers/análise via REST, conecta ao WebSocket do backend com reconexão exponencial, gerencia alertas e o símbolo ativo (`window.activeSymbol`).
- **`js/chart.js`** — classe `MarketChart`: candlesticks + volume + EMA9/EMA21/SMA50 + linhas de preço para S/R, usando Lightweight Charts.
- **`js/indicators.js` / `js/predictions.js`** — renderizam o painel de indicadores, tabela de S/R, cards de previsão, conectores bull/bear, histórico de acurácia.
- **`js/glossary.js`** — tooltips explicativos (propósito educacional) para cada indicador.
- **`js/chat.js`** — UI do chat: histórico de mensagens, chips de perguntas rápidas, parsing manual de SSE (`content_block_delta`/`text_delta`), indicador de "digitando", botão de copiar, highlight visual nas linhas do painel de indicadores quando mencionadas na resposta.
- **`js/connectors.js`** — painéis de Danelfin, inteligência externa (Fear&Greed/CoinGecko/Glassnode), notícias (com botão "Perguntar à IA" que injeta a notícia como contexto no chat), e controles do TrendSpider (config, teste de conexão, log).

### 3.4 Testes (`tests/`)

- **`analysis.test.js`** (18 testes) — RSI (monotônico, dados insuficientes, preço constante), MACD (plano, tendência, dados insuficientes), ATR, Bollinger (colapso de volatilidade zero, expansão), volume ratio, padrões de candle (Doji, Engulfing), pivot points, SMA, EMA.
- **`predictions.test.js`** (5 testes) — formato de saída para os dois intervalos, range de 15min mais estreito que 1h, viés correto em tendência de alta/baixa, e um exemplo logado com dados sintéticos estilo BTC (~$63.800).
- Executados com `node --test tests/*.test.js` (test runner nativo do Node, sem dependência externa). **Todos os 23 testes passam.**

---

## 4. Histórico de commits (branch `claude/gallant-bohr-dus2lw`)

Em ordem cronológica:

### 1. `f2e532f` — Add MarketDesk: real-time educational crypto market desk
Implementação inicial completa: backend dual (Cloudflare Workers + Durable Objects, e Node/Express + ws + SQLite para Oracle), engines compartilhados de análise técnica e previsão, frontend vanilla JS com Lightweight Charts, indicadores, mapa de S/R, conectores de decisão, glossário, log de histórico e alertas.

### 2. `07d0731` — Add AI chat (Claude tool-use + streaming) and external connectors
Adiciona `/api/chat` com prompt consciente do mercado, tool use (preço, Danelfin, Fear&Greed, previsões, S/R, notícias) e streaming SSE em ambos os backends. Adiciona painel de Danelfin, painel de inteligência externa (Fear&Greed/CoinGecko/Glassnode), feed de notícias com sentimento via RSS, e bridge bidirecional de webhook com TrendSpider — mais o painel de chat e dashboards de conectores no frontend.

### 3. `aa47f76` — Add unit tests for analysis/prediction engines and fix explanation grammar
Cobertura via `node:test` de RSI, MACD, ATR, Bollinger, volume, padrões e pivots, mais testes do engine de previsão incluindo um exemplo trabalhado com BTC. **Corrige um bug de gramática** no texto de explicação da previsão de 1h ("Para os próxima hora" → "Para a próxima hora").

### 4. `825eb58` — Clarify Cloudflare Pages deploy command in README
`wrangler pages deploy` precisa de um argumento de diretório explícito apontando para `frontend/`; rodá-lo sem argumento, ou de dentro de `cloudflare/` (que só tem código do Worker), causa o erro "Could not detect a directory containing static files". **Causa raiz**: o usuário rodou o comando sem apontar a pasta.

### 5. `34975e2` — Serve frontend static assets directly from the Cloudflare Worker
Adiciona um binding `[assets]` (`run_worker_first`) no `wrangler.toml` apontando para `../frontend`, com fallback no `fetch()` handler do Worker. **Corrige** o problema de abrir a URL nua do Worker e receber um JSON bruto `{"error":"Not found"}` em vez do app — e remove a necessidade de um deploy separado no Pages.

### 6. `e72ddbe` — Fix Worker name mismatch and missing static assets in Workers Builds CI
Logs de CI real mostraram 3 problemas:
- O `name` do `wrangler.toml` não batia com o projeto conectado no dashboard (`oremetfintech`).
- O diretório de assets `../frontend` resolvia para zero arquivos, porque o Workers Builds só faz checkout do "Root directory" configurado (`cloudflare/`), excluindo a pasta-irmã `frontend/`.
- O ID do namespace KV ainda era um placeholder.

Correções: renomeia o Worker para `oremetfintech`; cria `cloudflare/public/` como **cópia committed** do frontend (sempre presente, independente do root directory da CI) com script `sync-assets`; sobe o `wrangler` para `^4.20.0` (suporte a Static Assets).

### 7. `ed04fb6` — Set real KV namespace IDs for the deskmk namespace
Substitui os IDs placeholder pelos IDs reais do namespace `deskmk` criado pelo usuário no dashboard Cloudflare. Resolve o erro fatal `code: 10042` (KV namespace inválido).

### 8. `931f23d` — Use new_sqlite_classes for the MarketHub Durable Object migration
Contas no plano free exigem armazenamento de Durable Objects baseado em SQLite. Troca a migration de `new_classes` para `new_sqlite_classes`. Resolve o erro fatal `code: 10097`.

### 9. `9a7827e` — Switch Cloudflare chat to Workers AI instead of Anthropic API
Evita exigir uma `ANTHROPIC_API_KEY` paga para o recurso de chat no Worker. Passa a usar o binding nativo `env.AI` com Llama 3.3 70B (function calling), mantendo o mesmo envelope SSE que o frontend já interpreta (zero mudança no frontend). O backend Oracle continua usando Anthropic, já que não tem acesso ao binding Workers AI.

---

## 5. Problemas reais de deploy enfrentados e resolvidos

Durante o deploy real em produção (Cloudflare Workers Builds, CI conectada via Git), surgiram, em sequência, os seguintes erros — todos diagnosticados e corrigidos neste projeto:

| # | Erro | Causa raiz | Correção |
|---|---|---|---|
| 1 | `Could not detect a directory containing static files` | `wrangler pages deploy` rodado sem apontar a pasta `frontend/` | Documentado o comando correto no README |
| 2 | Worker abre e mostra `{"error":"Not found"}` em JSON | Worker não tinha rota `/` nem servia assets estáticos | Adicionado `[assets]` + fallback `env.ASSETS.fetch()` |
| 3 | `Worker name mismatch` (aviso) | `name` no `wrangler.toml` não batia com o projeto do dashboard | `name = "oremetfintech"` |
| 4 | `No files to upload` (assets) | CI com "Root directory" = `cloudflare/`, então `../frontend` ficava fora do checkout | Cópia committed em `cloudflare/public/` + `npm run sync-assets` |
| 5 | `KV namespace ... is not valid [code: 10042]` | ID do namespace KV ainda era placeholder | Usuário criou namespace `deskmk` no dashboard; IDs reais colados no `wrangler.toml` |
| 6 | `must create a namespace using a new_sqlite_classes migration [code: 10097]` | Plano free exige Durable Objects com storage SQLite | Migration trocada para `new_sqlite_classes` |

Após essas 6 correções, o deploy via CI completou com sucesso (`✨ Success! Build completed.`).

---

## 6. Decisão de arquitetura: Workers AI em vez de Anthropic (Cloudflare)

O usuário não possuía uma API key da Anthropic. Para evitar bloquear o recurso de chat, o backend Cloudflare foi migrado para usar o **binding nativo `env.AI` (Cloudflare Workers AI)**, modelo `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, que suporta function calling (tool use) e streaming, e está disponível **gratuitamente** (cota de neurônios incluída em toda conta Cloudflare) — sem necessidade de nenhuma chave de API.

O backend **Oracle** continua usando a API da Anthropic (`claude-sonnet-4-6`) porque o binding `env.AI` só existe dentro do runtime de Cloudflare Workers — não é acessível de um processo Node.js tradicional.

O contrato de streaming (eventos SSE `content_block_delta`/`text_delta`) foi mantido idêntico nos dois backends, então o frontend (`frontend/js/chat.js`) funciona sem nenhuma alteração, independente de qual IA está rodando por trás.

---

## 7. Variáveis de ambiente — resumo

| Variável | Obrigatória? | Onde | Propósito |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Só no Oracle | `oracle/ecosystem.config.cjs` / env do processo | Chat via Claude (Oracle apenas) |
| `DANELFIN_API_KEY` | Opcional | secret no Worker / env Oracle | AI Score de ações correlatas ao BTC |
| `GLASSNODE_API_KEY` | Opcional | idem | Métricas on-chain |
| `MESSARI_API_KEY` | Opcional | idem | Reservado para uso futuro |
| `CRYPTOQUANT_WEBHOOK_SECRET` | Opcional | idem | Reservado para validação de webhooks |
| — | — | UI (painel TrendSpider) | URL de webhook outbound, salva em KV/memória, não é env var |

Cloudflare Workers AI (`env.AI`) e KV (`MARKET_KV`) não são variáveis de ambiente — são **bindings** configurados em `wrangler.toml`.

---

## 8. Estado atual do projeto

- ✅ Backend Cloudflare deployado com sucesso via Workers Builds CI.
- ✅ Frontend servido pelo próprio Worker (`[assets]`), uma única URL para tudo.
- ✅ KV namespace real configurado (`deskmk`).
- ✅ Durable Object `MarketHub` com migration SQLite compatível com plano free.
- ✅ Chat funcionando via Cloudflare Workers AI, sem custo de API key.
- ✅ 23 testes unitários passando (`npm test` na raiz de `marketdesk/`).
- ⏳ Backend Oracle implementado e documentado, mas não deployado nesta sessão (depende de uma instância OCI provisionada manualmente pelo usuário).
- ⏳ Chaves opcionais (Danelfin, Glassnode, Messari, CryptoQuant) não configuradas — funcionalidades correspondentes degradam graciosamente exibindo aviso em vez de erro.
