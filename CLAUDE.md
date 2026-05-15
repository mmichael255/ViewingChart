# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (from repo root)
./start_app.sh dev          # Backend :8000 (hot-reload), Frontend :3000 (next dev)

# Production (single host)
./start_app.sh prod         # Backend :8000 (uvicorn), Frontend build + next start

# Docker Compose
cp .env.example .env && docker compose up -d --build

# CI Docker Compose (GitHub Actions)
cp .env.ci .env && docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --build

# Backend tests
cd backend && source .venv/bin/activate && pytest

# Frontend lint
cd frontend && npm run lint

# Frontend build
cd frontend && npm run build

# Database migrations
cd backend && source .venv/bin/activate && alembic upgrade head

# Seed kline data
cd backend && ./.venv/bin/python seed_candles.py --mode http --symbol BTCUSDT --interval 1h --limit 1000 --asset-type crypto

# Health checks
curl http://localhost:8000/health   # Backend health (public)
curl http://localhost:8000/docs     # Swagger UI
curl http://localhost:8000/metrics  # Prometheus metrics

## Kline scheduler env vars (backend/.env)

| Var | Default | Description |
|-----|---------|-------------|
| `KLINE_SCHEDULER_ENABLED` | (unset) | Set "true" to enable auto backfilling |
| `KLINE_SCHEDULER_CYCLE_S` | 900 | Fast cycle interval (seconds) |
| `KLINE_SCHEDULER_DEEP_CYCLE_S` | 86400 | Deep cycle interval (seconds, 24h) |
| `KLINE_SCHEDULER_TAIL_LIMIT` | 100 | Candles to tail-fetch per fast cycle |
| `KLINE_SCHEDULER_BACKFILL_LIMIT` | 200000 | Max candles for full backfill |
| `KLINE_SCHEDULER_BACKFILL_LIMIT_1M` | 1000000 | Max 1m candles for backfill |
| `KLINE_SCHEDULER_SCAN_WINDOW` | 5000 | Window size for internal gap scan |
| `KLINE_SCHEDULER_CORRECTION_LIMIT` | 200 | Max candles to correct per deep cycle |
| `KLINE_SCHEDULER_BINANCE_RPM` | 600 | Binance API rate limit (req/min) |
| `KLINE_SCHEDULER_YFINANCE_RPM` | 20 | Yahoo Finance rate limit (req/min) |
| `KLINE_SCHEDULER_LOG_PATH` | `logs/scheduler.log` | Scheduler log file path (daily rotation) |
```

## Architecture

**Full-stack financial charting app** — crypto (Binance WebSocket/REST) and stock/forex (yfinance, Alpha Vantage) data with TradingView Lightweight Charts, watchlists, AI chat, and drawing tools.

### Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (static export), React 19, TypeScript 5, Tailwind CSS v4 |
| Charting | TradingView Lightweight Charts 5.1 |
| State | SWR (REST caching/polling), Zustand (global state) |
| Backend | Python 3.11, FastAPI, Uvicorn |
| ORM | SQLAlchemy + PyMySQL |
| DB | MariaDB 11, Redis 7 (cache + pub/sub) |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Infra | Docker Compose, nginx, GitHub Actions CI/CD |

### Key directories

- `backend/app/main.py` — FastAPI entrypoint, CORS, middleware, router registration
- `backend/app/config.py` — All settings from `.env`, Redis pool
- `backend/app/database/models.py` — ORM models: User, Watchlist, WatchlistItem, Symbol, Kline
- `backend/app/routers/` — REST endpoints (market_data, auth, watchlists, chat, news, health)
- `backend/app/services/` — Business logic (binance_service, stock_service, websocket_manager, llm_service, news_service, kline_scheduler)
- `backend/docker-entrypoint.sh` — Container entrypoint with Alembic retry logic (30 retries, 2s delay)
- `frontend/src/app/page.tsx` — Main chart page (~840 lines, core UI orchestration)
- `frontend/src/components/ChartComponent.tsx` — TradingView chart wrapper
- `frontend/src/hooks/useMarketData.ts` — Data fetching (SWR + WebSocket + batching)
- `frontend/src/components/WatchlistSidebar.tsx` — Watchlist UI
- `frontend/src/drawing/` — Drawing tools (DrawingManager, primitives like TrendLine, Fibonacci)

### Data flow

1. **Crypto (Binance):** `websocket_manager.py` maintains two WebSocket connections (spot + futures) with auto-reconnect. Incoming kline/ticker data is published to Redis channels (`market:kline`, `market:ticker`). A Redis listener broadcasts to browser clients. Buffered klines flush to MariaDB every 30s.

2. **Stocks/Forex:** `stock_service.py` uses yfinance (stocks) and Alpha Vantage (forex/metals). Results cached in Redis with dynamic TTL based on market session. Frontend polls REST API every 60s.

3. **Kline persistence (scheduler):** `kline_scheduler.py` runs a two-tier cycle for superadmin watchlist symbols:
   - **Fast cycle** (default 15min): tail-fills recent candles from API and aggregates derived intervals (3m, 5m, 30m, 1w, 1M) from stored data
   - **Deep cycle** (default 24h): full-history backfill for new symbols, early-gap backfill, internal gap scan, and auto-correct of existing data

4. **Frontend:** `useMarketData` hook uses SWR for initial REST fetch, then WebSocket for crypto real-time updates. Updates batch via `requestAnimationFrame` (100ms interval). Includes connection resilience: transport watchdog, stale data detection, tab visibility handling.

### API (all prefixed `/api/v1`)

- `GET /market/klines/{symbol}` — Historical klines
- `GET /market/tickers` — Ticker data
- `GET /market/search` — Symbol search
- `WS /market/ws/{symbol}/{interval}` — Kline real-time
- `WS /market/ws/tickers` — Ticker real-time
- `POST /auth/register`, `/auth/login` — Auth
- `GET/POST /watchlists` — Watchlist CRUD
- `POST /chat` — AI chat (OpenAI via LangChain)
- `GET /news` — News feed
- `GET /health` — Health check (public, no auth required)
- `GET /metrics` — Prometheus metrics

### Key design decisions

- Frontend is statically exported (`output: "export"`), served by nginx — no Node.js server at runtime
- Redis pub/sub enables multi-process/instance Binance stream fan-out
- Stock data uses polling (yfinance is sync); crypto uses WebSocket for real-time
- All config from root `.env`, loaded in `backend/app/config.py`
- JWT tokens expire in 7 days; auto-creates default watchlist on registration
- Two user roles: `user` and `superadmin` (superadmin required for monitor dashboard)
- Kline scheduler uses two-tier cycle: fast (15min tail-fill) and deep (24h backfill/gap-scan/auto-correct)
- Derived intervals (3m, 5m, 30m, 1w, 1M) are aggregated from stored data, not fetched from APIs
- Health endpoint is public (no auth) for load balancer checks
- Docker entrypoint retries `alembic upgrade head` up to 30 times before starting the app

## Env vars

When adding a new environment variable to the codebase, add it to `.env.example` (root) and document it in the env vars table above.

## Debugging

See `docs/debug-guide.md` for the debugging workflow.

## Deployment

- Development work happens on the `dev` branch
- Changes are merged to `main` and pushed to origin
- The production server mirrors `main` — it pulls and restarts containers
- Server runs via `docker compose` with `.env` for configuration
- Backend entrypoint runs `alembic upgrade head` on each restart