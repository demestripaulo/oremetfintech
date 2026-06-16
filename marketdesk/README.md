# MarketDesk

Mesa de análise financeira educacional em tempo real, com foco em Bitcoin e
principais criptomoedas (BTC, ETH, SOL, BNB, XRP). Exibe candlesticks,
indicadores técnicos (RSI, MACD, Bollinger, ATR, padrões de vela), previsões
de range para 15 minutos / 1 hora, conectores de decisão (bull/bear) e um
log retrospectivo de acurácia.

⚠️ **Esta ferramenta é educacional.** Projeções são baseadas em análise
técnica histórica e não constituem conselho financeiro.

## Estrutura

```
marketdesk/
├── cloudflare/   # Backend opção A: Cloudflare Workers + Durable Objects + KV
├── oracle/       # Backend opção B: Node.js/Express + ws + SQLite + PM2 + Nginx
└── frontend/     # App single-page (HTML/CSS/JS puro), serve qualquer dos dois backends
```

Escolha **uma** das duas opções de backend. O frontend é o mesmo para ambas —
ele aponta para `window.location.origin` por padrão (ver `frontend/index.html`).

---

## Opção A — Deploy no Cloudflare Workers

Pré-requisitos: conta Cloudflare, Node.js 20+, `npm install -g wrangler` (ou use `npx wrangler`).

```bash
cd marketdesk/cloudflare
npm install

# 1. Login no Cloudflare
npx wrangler login

# 2. Criar o KV namespace usado para cache de histórico de previsões
npx wrangler kv:namespace create marketdesk_kv
# Copie o "id" retornado para wrangler.toml em [[kv_namespaces]] -> id
# (opcional) crie também um preview namespace para `wrangler dev`:
npx wrangler kv:namespace create marketdesk_kv --preview
# Copie o "preview_id" para wrangler.toml -> preview_id
```

⚠️ **O deploy falha com `KV namespace 'REPLACE_WITH_YOUR_KV_NAMESPACE_ID'
is not valid [code: 10042]` até você substituir esses dois placeholders**
em `wrangler.toml` pelos IDs reais retornados nos comandos acima — o
repositório não pode conter o ID da sua conta, então isso é sempre um
passo manual.

```bash

# 3. Testar localmente
npx wrangler dev

# 4. Deploy em produção
npx wrangler deploy
```

Isso publica o Worker (rotas REST `/api/*`, WebSocket `/ws` via Durable
Object `MarketHub`, e o Cron Trigger `*/15 * * * *` que recalcula e
persiste previsões para todos os símbolos) **e também o frontend
estático**, pela mesma URL.

### Frontend servido pelo próprio Worker (recomendado)

`cloudflare/wrangler.toml` já tem um bloco `[assets]` apontando para
`cloudflare/public/` (uma cópia de `../frontend`, ver abaixo) com
`run_worker_first = true`: o Worker sempre roda primeiro, atende
`/api/*`, `/ws` e `/webhooks/*`, e qualquer outra rota (`/`, `/css/*`,
`/js/*`) cai automaticamente no binding `ASSETS`. Não é preciso
configurar `API_BASE`/`WS_URL` manualmente — `frontend/index.html` já
usa `window.location.origin`, que aponta para o próprio Worker.

Se você acessou a URL do Worker e viu um JSON de erro
`{"error":"Not found"}` em vez do app, é porque o deploy foi feito
**antes** dessa configuração de assets — rode `npx wrangler deploy`
novamente a partir de `marketdesk/cloudflare/` para publicar a versão
atual.

Se o log do deploy mostrar `No files to upload` para os assets (comum
em builds conectados via Git/Workers Builds, quando o "Root directory"
configurado no dashboard é `marketdesk/cloudflare/` e portanto
`../frontend` fica fora do que foi baixado): por isso o diretório de
assets aponta para `public/`, que é uma cópia committada de
`../frontend` **dentro** de `cloudflare/`. Depois de editar qualquer
arquivo em `frontend/`, sincronize antes de commitar:

```bash
cd marketdesk/cloudflare
npm run sync-assets   # copia ../frontend -> public/
git add public
```

Se o painel do Cloudflare (Workers Builds) mostrar um aviso de
`Worker name mismatch` (o `name` em `wrangler.toml` não bate com o nome
do projeto conectado), edite o campo `name` em `wrangler.toml` para o
nome exato do seu projeto Cloudflare — ele já está como `oremetfintech`
neste repositório; ajuste se o seu projeto tiver outro nome.

Requer wrangler 3.90+ para suportar Static Assets em Workers; se o
deploy falhar reclamando do bloco `[assets]`, rode
`npm install -D wrangler@latest` dentro de `marketdesk/cloudflare/`.

### Alternativa: frontend separado no Cloudflare Pages

Se preferir hospedar o frontend em outro domínio/projeto (ex.: Pages),
ainda é possível:

```bash
cd marketdesk/frontend
npx wrangler pages deploy . --project-name=marketdesk
```

⚠️ Aponte o comando para a pasta `frontend/` (que contém `index.html`,
`css/` e `js/`). Rodar `wrangler pages deploy` sem argumento de
diretório, ou de dentro de `marketdesk/cloudflare/` (que só tem código
do Worker, sem HTML/CSS), gera o erro:
`Could not detect a directory containing static files`.

Nesse caso, edite `frontend/index.html` e aponte
`window.MARKETDESK_CONFIG.API_BASE`/`WS_URL` para a URL do Worker (que
fica em domínio diferente do Pages), por exemplo:

```js
window.MARKETDESK_CONFIG = {
  API_BASE: "https://marketdesk.<seu-subdominio>.workers.dev",
  WS_URL: "wss://marketdesk.<seu-subdominio>.workers.dev/ws",
};
```

### Domínio customizado (Cloudflare)

No `wrangler.toml`, adicione:

```toml
routes = [{ pattern = "marketdesk.seudominio.com/*", custom_domain = true }]
```

E garanta que o domínio esteja na mesma conta Cloudflare (zona DNS gerenciada
pela Cloudflare). Depois rode `npx wrangler deploy` novamente.

### Variáveis de ambiente

Definidas em `[vars]` no `wrangler.toml` (ex.: `ENVIRONMENT`). Não há
chaves de API necessárias — Binance e CoinGecko são usadas como APIs
públicas sem autenticação.

---

## Opção B — Deploy no Oracle Cloud (OCI Free Tier, Ubuntu 22.04 ARM Ampere A1)

1. Crie uma instância Compute "Always Free" (Ampere A1, Ubuntu 22.04) na OCI.
2. Abra as portas 80 e 443 na **Security List** da VCN (Networking > VCN >
   Security Lists > Add Ingress Rule, para `0.0.0.0/0`, portas 80 e 443 TCP).
3. Conecte via SSH e clone este repositório.

```bash
cd marketdesk/oracle
chmod +x setup.sh
./setup.sh
```

O script `setup.sh`:
- Atualiza o sistema e instala build tools (necessários para compilar o
  `better-sqlite3` nativamente em ARM), Node.js 20, PM2 e Nginx.
- Instala as dependências do projeto (`npm install`).
- Copia `nginx.conf` para `/etc/nginx/sites-available/` e ativa o site.
- Inicia o processo com PM2 (`ecosystem.config.js`) e configura
  `pm2 startup` para reiniciar automaticamente após reboot.

Após o setup, o backend roda em `http://127.0.0.1:8080` (proxy reverso do
Nginx expõe na porta 80) e o WebSocket fica disponível em `/ws`.

### Domínio customizado e HTTPS (Oracle)

1. Aponte o DNS do seu domínio (registro A) para o IP público da instância.
2. Edite `server_name` em `nginx.conf` (e em `/etc/nginx/sites-available/marketdesk.conf`)
   para o seu domínio.
3. Rode:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d marketdesk.seudominio.com
   ```
   Isso configura HTTPS/WSS automaticamente via Let's Encrypt.

### Variáveis de ambiente

- `PORT` (padrão `8080`) — porta interna do servidor Node, definida em
  `ecosystem.config.js`.

### Comandos úteis (PM2)

```bash
pm2 status
pm2 logs marketdesk
pm2 restart marketdesk
```

---

## Reconexão de WebSocket

Tanto o `MarketHub` (Durable Object, Cloudflare) quanto o relay WS do
servidor Oracle reconectam automaticamente ao stream upstream da Binance
usando backoff exponencial (1s, 2s, 4s, ... até 30s). O frontend
(`frontend/js/app.js`) também reconecta ao backend com a mesma estratégia.

## Rate limiting e cache

Toda chamada REST à Binance passa por um throttle mínimo de ~120ms entre
requisições e por um cache de no mínimo 5 segundos (em memória), tanto no
Worker quanto no servidor Node, evitando exceder os limites públicos da
Binance API.

## Fontes de dados

- Binance WebSocket (`wss://stream.binance.com:9443/stream?streams=...@kline_1m`)
- Binance REST (`/api/v3/klines`, `/api/v3/ticker/24hr`)
- CoinGecko (`/coins/{id}/ohlc`) como fallback caso a Binance esteja
  inacessível.

---

## Módulo de IA — Chat com Claude + Conectores Externos

### Chat com Claude (`/api/chat`)

O chat injeta automaticamente um snapshot do mercado (preço, RSI, MACD,
volume, padrão de candle, S/R, previsões 15min/1h) no `system` prompt a
cada mensagem, e usa **tool use** para Claude consultar dados em tempo
real (`get_current_price`, `get_danelfin_score`, `get_fear_greed`,
`get_price_prediction`, `get_support_resistance`, `get_recent_news`).
A resposta final é transmitida via SSE (Server-Sent Events), com
passthrough dos eventos nativos do streaming da Anthropic API
(`content_block_delta` / `text_delta`).

Variável obrigatória para habilitar o chat:

```
ANTHROPIC_API_KEY=sk-ant-...
```

- **Cloudflare:** `wrangler secret put ANTHROPIC_API_KEY`
- **Oracle:** defina no ambiente do processo (ex.: exportar antes de
  `pm2 start`, ou editar `oracle/ecosystem.config.cjs`).

### Danelfin (ações correlatas ao BTC)

`GET /api/connectors/danelfin` retorna AI Scores (1–10) para
MSTR, COIN, MARA, RIOT e IBIT. Requer `DANELFIN_API_KEY` (plano pago em
danelfin.com/pricing/api). Sem a chave, o painel exibe um aviso por
ativo em vez de falhar.

### TrendSpider (webhook bidirecional)

TrendSpider não expõe API pública de dados — a integração é via webhook:

- **Receber alertas do TrendSpider:** configure em TrendSpider
  *Settings > Webhooks* a URL `https://<seu-app>/webhooks/trendspider`.
  O payload esperado é `{ symbol, alert_type, price, timeframe, message, timestamp }`.
  Cada evento recebido é logado, notificado em tempo real no dashboard
  (via WebSocket) e dispara o alerta sonoro/visual configurado.
- **Enviar alertas para o TrendSpider:** cole a URL do seu webhook de
  entrada do TrendSpider no painel "TrendSpider Webhook" da UI, ative o
  toggle e clique em "Testar conexão". O job periódico de 15 minutos
  envia automaticamente um alerta quando um padrão de candle relevante
  (não neutro) é detectado.

### Inteligência externa (gratuita)

`GET /api/connectors/intelligence` agrega:
- **Fear & Greed Index** (alternative.me, gratuito, sem chave).
- **Sentimento social/dev** (CoinGecko `/coins/bitcoin`, gratuito).
- **On-chain** (Glassnode — endereços ativos, exchange netflow, SOPR).
  Requer `GLASSNODE_API_KEY` (tier gratuito em glassnode.com/login);
  sem a chave, os campos retornam erro individualmente sem quebrar o painel.

`GET /api/connectors/news?asset=bitcoin` agrega notícias das últimas 2h
de feeds RSS públicos (CoinDesk, Cointelegraph, CryptoNews), filtradas
por palavras-chave e classificadas localmente como BULLISH/BEARISH/NEUTRO
por keyword matching. Cada item tem um botão "Perguntar ao Claude" que
injeta a notícia como contexto no chat.

Messari (`data.messari.io`) está implementado em `connectors.js`
(`getMessariMetrics`) para uso futuro/manual via tool use — os endpoints
básicos são gratuitos e não exigem chave.

### Variáveis de ambiente — resumo completo

```
# Obrigatório para o chat
ANTHROPIC_API_KEY=sk-ant-...

# Opcionais (funcionalidades extras; degradam graciosamente sem elas)
DANELFIN_API_KEY=...           # danelfin.com/pricing/api
GLASSNODE_API_KEY=...          # glassnode.com (free tier)
MESSARI_API_KEY=...            # messari.io (free, não exigido pelos endpoints básicos)
CRYPTOQUANT_WEBHOOK_SECRET=...  # reservado para validação de webhooks CryptoQuant

# Configurado pelo usuário via UI (painel TrendSpider), não por env var
# TRENDSPIDER_WEBHOOK_URL é salvo no KV (Cloudflare) ou em memória (Oracle)
```
