# ViewingChart Deployment Notes

This project contains:

- `backend`: FastAPI service (REST + WebSocket)
- `frontend`: Next.js app

## Quick Start (Development)

Run from repo root:

```bash
./start_app.sh dev
```

Backend: `http://localhost:8000`  
Frontend: `http://localhost:3000`

## Production Readiness Checklist

- Backend tests pass: `cd backend && source .venv/bin/activate && pytest`
- Frontend lint passes: `cd frontend && npm run lint`
- Frontend build passes: `cd frontend && npm run build`
- root `.env` is configured for production values
- Strong secrets are used (no demo/default keys)
- `CORS_ORIGINS` only includes your deployed frontend domain
- MariaDB and Redis are reachable from the backend host

## Production Run (Single Host)

1. Set production environment variables in root `.env`:
  - `ENVIRONMENT=production`
  - `LOG_LEVEL=INFO`
  - `CORS_ORIGINS=https://your-frontend-domain`
  - production DB/Redis/API credentials
2. Start both services:

```bash
./start_app.sh prod
```

This launches:

- Backend with `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1`
- Frontend with `next build` and `next start`

## Docker Compose Deployment (Server)

From repo root:

1. Prepare environment file:

```bash
cp .env.example .env
```

1. Edit `.env` with your server IP/domain and secrets:
  - `DB_PASSWORD`
  - `CORS_ORIGINS`
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_WS_URL`
  - optional API keys
2. Build and start:

```bash
docker compose up -d --build
```

1. Verify services:

```bash
docker compose ps
curl http://localhost:8000/health
```

Default exposed ports:

- Frontend: `3000`
- Backend: `8000`
- Redis: `6379`

If you use a host-installed database (not Docker), set:

- `DB_HOST=host.docker.internal`
- `DB_PORT=3306`

Stop:

```bash
docker compose down
```

## Seed Helpers

Create database only:

```bash
./seeddb.sh
```

Backfill kline/candle data via HTTP API:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
python seed_candles.py --mode http --symbol BTCUSDT --interval 1h --limit 1000 --asset-type crypto
```

Collect closed candles via WS and persist:

```bash
cd backend
python seed_candles.py --mode ws --symbol BTCUSDT --interval 1m --sample-size 5 --asset-type crypto
```

If you hit `ModuleNotFoundError` (for example `websockets`), run with the project venv interpreter explicitly:

```bash
cd backend
./.venv/bin/python seed_candles.py --mode ws --symbol BTCUSDT --interval 1h --sample-size 5 --asset-type crypto
```

Auto fill gaps (tail + internal scan by default):

```bash
cd backend
./.venv/bin/python seed_candles.py --mode fill-gaps --symbol BTCUSDT --interval 1h --asset-type crypto
```

Fill behavior (current implementation):

- Tail fill: extends from newest DB candle to latest closed candle.
- Internal scan: segmented full-history scan by default (ascending `open_time`).
- Internal fetch: each detected gap is backfilled with time-bounded API requests (`startTime/endTime`) for that gap span.
- Upsert semantics: duplicate candles update existing rows via unique key `(symbol_id, bar_interval, open_time)`.

Optional switches for fill mode:

- `--scan-window 5000`: internal scan segment size (rows per DB batch) for full-history scanning
- `--scan-start-time yyyymmddHHmmss`: optional internal scan start (UTC, 24h). If omitted, uses earliest DB candle time.
- `--scan-end-time yyyymmddHHmmss`: optional internal scan end (UTC, 24h). If omitted, uses latest DB candle time.
- `--no-tail`: skip tail-gap filling (only internal scan)
- `--no-internal`: skip internal scan (only tail-gap filling)
- `--dry-run`: print gap-fill plan (would-save counts) without writing to DB
- `--auto-correct`: compare recent DB candles with API candles and upsert mismatches/missing rows
- `--correction-limit 1000`: number of most recent candles to verify for correction
- `--include-current-candle`: include the current open candle in correction checks

Dry run examples:

```bash
cd backend
./.venv/bin/python seed_candles.py --mode fill-gaps --symbol BTCUSDT --interval 1h --asset-type crypto --dry-run
```

```bash
cd backend
./.venv/bin/python seed_candles.py --mode fill-gaps --symbol BTCUSDT --interval 1h --asset-type crypto --scan-start-time 20260413000000 --scan-end-time 20260420000000 --dry-run
```

Auto-correct tutorial (fix wrong candles):

1. Run correction-only mode for recent closed candles:

```bash
cd backend
./.venv/bin/python seed_candles.py --mode correct --symbol BTCUSDT --interval 1m --asset-type crypto --correction-limit 1000
```

2. Include current/open candle if you also want to fix the live bar:

```bash
cd backend
./.venv/bin/python seed_candles.py --mode correct --symbol BTCUSDT --interval 1m --asset-type crypto --correction-limit 1000 --include-current-candle
```

3. Preview first (no DB writes):

```bash
cd backend
./.venv/bin/python seed_candles.py --mode correct --symbol BTCUSDT --interval 1m --asset-type crypto --correction-limit 1000 --include-current-candle --dry-run
```

You can also keep using `--mode fill-gaps` and add `--auto-correct` to run gap filling plus correction in one command.

## Basic Health Checks

- Backend health: `GET /health`
- API docs: `GET /docs`
- Metrics: `GET /metrics`

