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
- Backend with `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2`
- Frontend with `next build` and `next start`

## Docker Compose Deployment (Server)

From repo root:

1. Prepare environment file:

```bash
cp .env.example .env
```

2. Edit `.env` with your server IP/domain and secrets:
   - `DB_PASSWORD`
   - `CORS_ORIGINS`
   - `NEXT_PUBLIC_API_URL`
   - `NEXT_PUBLIC_WS_URL`
   - optional API keys

3. Build and start:

```bash
docker compose up -d --build
```

4. Verify services:

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

## Basic Health Checks

- Backend health: `GET /health`
- API docs: `GET /docs`
- Metrics: `GET /metrics`