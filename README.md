# Puppeteer Queue API (JavaScript + Express)

API HTTP para gerenciar fila local de navegações com Puppeteer. Sem Redis/Docker. Inclui retries com backoff e `/metrics` (Prometheus).

## Rodar
```bash
npm i
cp .env.example .env   # ajuste se quiser
npm run dev
```

## Rotas
- `POST /tasks` – cria tarefa `{ url, repeat, intervalMs, ... }`
- `POST /tasks/batch` – cria várias
- `GET /tasks` – lista
- `GET /tasks/:id` – detalhes
- `GET /tasks/:id/runs` – execuções
- `POST /tasks/:id/pause|resume|cancel`
- `GET /health`
- `GET /metrics` – Prometheus

## Variáveis
Veja `.env.example` (concorrência, retries, backoff, rate-limit, hosts bloqueados).
