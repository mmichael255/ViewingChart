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
curl http://localhost:8000/health   # Backend health
curl http://localhost:8000/docs     # Swagger UI
curl http://localhost:8000/metrics  # Prometheus metrics
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
- `backend/app/services/` — Business logic (binance_service, stock_service, websocket_manager, llm_service, news_service)
- `frontend/src/app/page.tsx` — Main chart page (~840 lines, core UI orchestration)
- `frontend/src/components/ChartComponent.tsx` — TradingView chart wrapper
- `frontend/src/hooks/useMarketData.ts` — Data fetching (SWR + WebSocket + batching)
- `frontend/src/components/WatchlistSidebar.tsx` — Watchlist UI
- `frontend/src/drawing/` — Drawing tools (DrawingManager, primitives like TrendLine, Fibonacci)

### Data flow

1. **Crypto (Binance):** `websocket_manager.py` maintains two WebSocket connections (spot + futures) with auto-reconnect. Incoming kline/ticker data is published to Redis channels (`market:kline`, `market:ticker`). A Redis listener broadcasts to browser clients. Buffered klines flush to MariaDB every 30s.

2. **Stocks/Forex:** `stock_service.py` uses yfinance (stocks) and Alpha Vantage (forex/metals). Results cached in Redis with dynamic TTL based on market session. Frontend polls REST API every 60s.

3. **Frontend:** `useMarketData` hook uses SWR for initial REST fetch, then WebSocket for crypto real-time updates. Updates batch via `requestAnimationFrame` (100ms interval). Includes connection resilience: transport watchdog, stale data detection, tab visibility handling.

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

### Key design decisions

- Frontend is statically exported (`output: "export"`), served by nginx — no Node.js server at runtime
- Redis pub/sub enables multi-process/instance Binance stream fan-out
- Stock data uses polling (yfinance is sync); crypto uses WebSocket for real-time
- All config from root `.env`, loaded in `backend/app/config.py`
- JWT tokens expire in 7 days; auto-creates default watchlist on registration
- Two user roles: `user` and `superadmin` (superadmin required for monitor dashboard)

## Deployment

- Development work happens on the `dev` branch
- Changes are merged to `main` and pushed to origin
- The production server mirrors `main` — it pulls and restarts containers
- Server runs via `docker compose` with `.env` for configuration
- Backend entrypoint runs `alembic upgrade head` on each restart