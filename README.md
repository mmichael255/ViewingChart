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
- `backend/.env` is configured for production values
- Strong secrets are used (no demo/default keys)
- `CORS_ORIGINS` only includes your deployed frontend domain
- MariaDB and Redis are reachable from the backend host

## Production Run (Single Host)

1. Set production environment variables in `backend/.env`:
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

## Basic Health Checks

- Backend health: `GET /health`
- API docs: `GET /docs`
- Metrics: `GET /metrics`