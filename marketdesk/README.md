# MarketDesk

Mesa de análise financeira educacional em tempo real, com foco em Bitcoin e
principais criptomoedas (BTC, ETH, SOL, BNB, XRP). Exibe candlesticks,
indicadores técnicos (RSI, MACD, Bollinger, ATR, padrões de vela), previsões
de range para 15 minutos / 1 hora / fechamento diário, Market Structure Score,
conectores de decisão (bull/bear) e um log retrospectivo de acurácia.

Suporte a **EN / PT-BR** via seletor de idioma. Dados via Coinbase → Binance →
Kraken → CoinGecko (fallback automático).

⚠️ **Esta ferramenta é educacional.** Projeções são baseadas em análise
técnica histórica e não constituem conselho financeiro.

## Estrutura

```
marketdesk/
├── cloudflare/      # Backend: Cloudflare Workers + Durable Objects + KV
├── frontend/        # Cópia de trabalho do frontend (sincronizar antes do deploy)
├── tests/           # Testes unitários (Node.js test runner nativo)
└── _archive/oracle/ # Backend legado Node.js/Express — arquivado, não usado no deploy
```

---

## Deploy no Cloudflare Workers

Pré-requisitos: conta Cloudflare, Node.js 20+, `npx wrangler`.

```bash
cd marketdesk/cloudflare
npm install

# 1. Login
npx wrangler login

# 2. Criar o KV namespace para cache do histórico de previsões
npx wrangler kv:namespace create marketdesk_kv
# Copie o "id" retornado para wrangler.toml em [[kv_namespaces]] -> id
# (opcional) namespace de preview para wrangler dev:
npx wrangler kv:namespace create marketdesk_kv --preview
# Copie o "preview_id" para wrangler.toml -> preview_id
```

⚠️ **O deploy falha com `KV namespace ... is not valid [code: 10042]`** até
você substituir os dois placeholders em `wrangler.toml` pelos IDs reais
retornados acima — o repositório não pode conter IDs da sua conta.

```bash
# 3. Testar localmente
npx wrangler dev

# 4. Deploy em produção
npx wrangler deploy
```

Isso publica o Worker (rotas REST `/api/*`, WebSocket `/ws` via Durable Object
`MarketHub`, Cron Trigger `*/15 * * * *`) **e o frontend estático** pela mesma
URL.

### Frontend servido pelo próprio Worker

`wrangler.toml` tem um bloco `[assets]` apontando para `cloudflare/public/`
com `run_worker_first = true`: o Worker atende `/api/*` e `/ws`; qualquer
outra rota cai no binding `ASSETS` (HTML/CSS/JS). Não é preciso configurar
`API_BASE`/`WS_URL` manualmente — `index.html` usa `window.location.origin`.

Se aparecer `{"error":"Not found"}` em vez do app ao abrir a URL, rode
`npx wrangler deploy` novamente a partir de `marketdesk/cloudflare/`.

### Sincronizar frontend antes do deploy

`cloudflare/public/` é uma cópia committed de `../frontend`. Após editar
qualquer arquivo em `frontend/`, sincronize antes de commitar:

```bash
cd marketdesk/cloudflare
npm run sync-assets   # copia ../frontend -> public/
git add public
```

### Worker name mismatch

Se o painel Cloudflare (Workers Builds) avisar `Worker name mismatch`, edite
o campo `name` em `wrangler.toml` para o nome exato do seu projeto Cloudflare
(já está como `oremetfintech` neste repositório).

### Domínio customizado

No `wrangler.toml`:

```toml
routes = [{ pattern = "marketdesk.seudominio.com/*", custom_domain = true }]
```

### Variáveis de ambiente

Nenhuma chave de API é obrigatória. Dados de mercado (Coinbase, Kraken,
CoinGecko) são públicos e gratuitos.

Chaves opcionais (degradam graciosamente sem elas):

```
wrangler secret put GLASSNODE_API_KEY     # on-chain metrics (free tier)
wrangler secret put MESSARI_API_KEY       # reservado para uso futuro
```

---

## Testes

```bash
cd marketdesk
node --test tests/analysis.test.js tests/predictions.test.js tests/connectors.test.js
# 27 testes passando
```

---

## Fontes de dados

| Fonte | Uso | Autenticação |
|---|---|---|
| Coinbase Exchange | Candles + ticker (primário) | Pública |
| Binance / Binance.US | Fallback de candles | Pública |
| Kraken | Fallback de candles | Pública |
| CoinGecko | Fallback final de candles | Pública |
| Alternative.me | Fear & Greed Index | Pública |
| CoinGecko | Sentimento social | Pública |
| Glassnode | On-chain (endereços, netflow) | Free tier (opcional) |
| RSS público | Notícias (CoinDesk, Cointelegraph, CryptoNews) | Pública |

---

## WebSocket e reconexão

O `MarketHub` (Durable Object) mantém o relay do stream Coinbase → Kraken para
os 5 símbolos ativos, reconectando com backoff exponencial (1s → 30s). O
frontend também reconecta com a mesma estratégia.
