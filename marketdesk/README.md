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

# 3. Testar localmente
npx wrangler dev

# 4. Deploy em produção
npx wrangler deploy
```

Isso publica o Worker (rotas REST `/api/*`, WebSocket `/ws` via Durable
Object `MarketHub`, e o Cron Trigger `*/15 * * * *` que recalcula e
persiste previsões para todos os símbolos).

### Servir o frontend junto com o Worker

A forma mais simples é hospedar `frontend/` no Cloudflare Pages e apontar
`window.MARKETDESK_CONFIG.API_BASE`/`WS_URL` (em `frontend/index.html`) para
a URL do Worker, por exemplo:

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
