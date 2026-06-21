# Oracle Backend — Arquivado

> **Este diretório está arquivado e não faz parte do deploy ativo.**
>
> O deploy atual é 100% Cloudflare Workers (`marketdesk/cloudflare/`).

## O que é

Backend alternativo Node.js/Express para rodar o MarketDesk em uma VM
tradicional (ex.: Oracle Cloud OCI Free Tier, Ampere A1 ARM, Ubuntu 22.04).

Stack: Express + `ws` + `better-sqlite3` + PM2 + Nginx.

## Por que foi arquivado

O deploy via Cloudflare Workers é mais simples, sem manutenção de infra e
escala automaticamente. O backend Oracle foi mantido como referência histórica.

## Para usar (se necessário)

```bash
cd marketdesk/_archive/oracle
npm install
node server.js
```

Ou com PM2:

```bash
pm2 start ecosystem.config.cjs
```

Consulte o `setup.sh` para provisionamento completo em Ubuntu 22.04 ARM.

## Diferenças em relação ao Cloudflare

- Chat usava Anthropic API (`ANTHROPIC_API_KEY`) em vez de Workers AI
- Log de previsões em SQLite (`db.js`) em vez de KV
- TrendSpider state em memória em vez de KV
- WebSocket relay em processo Node de longa duração em vez de Durable Object
