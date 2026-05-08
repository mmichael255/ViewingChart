#!/bin/bash
set -euo pipefail

MODE="${1:-dev}"

if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "Usage: ./start_app.sh [dev|prod]"
  exit 1
fi

# Load shared environment variables from repository root.
if [[ -f ".env" ]]; then
  set -a
  source .env
  set +a
fi

# In local dev we run frontend (3000) and backend (8000) directly, without nginx.
# If the repo root .env is configured for nginx (path-only /api/v1), normalize to
# direct backend URLs so Next.js doesn't 404 on its own dev server.
if [[ "$MODE" == "dev" ]]; then
  # Ensure backend runs in development mode locally, even if the repo root .env
  # is configured for a production-like environment.
  export ENVIRONMENT="development"

  # Local browser runs on localhost:* so ensure API CORS allows it.
  # Keep any user-provided CORS_ORIGINS and append common local dev origins.
  _DEV_CORS_APPEND="http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
  if [[ -z "${CORS_ORIGINS:-}" ]]; then
    export CORS_ORIGINS="$_DEV_CORS_APPEND"
  else
    export CORS_ORIGINS="${CORS_ORIGINS},${_DEV_CORS_APPEND}"
  fi

  if [[ "${NEXT_PUBLIC_API_URL:-}" == /* ]]; then
    export NEXT_PUBLIC_API_URL="http://localhost:8000${NEXT_PUBLIC_API_URL}"
  fi
  if [[ -z "${NEXT_PUBLIC_API_URL:-}" ]]; then
    export NEXT_PUBLIC_API_URL="http://localhost:8000/api/v1"
  fi

  if [[ -z "${NEXT_PUBLIC_WS_URL:-}" ]]; then
    export NEXT_PUBLIC_WS_URL="ws://localhost:8000/api/v1"
  elif [[ "${NEXT_PUBLIC_WS_URL:-}" == /* ]]; then
    export NEXT_PUBLIC_WS_URL="ws://localhost:8000${NEXT_PUBLIC_WS_URL}"
  fi
fi

# Start Backend
echo "Starting Backend (${MODE})..."
cd backend
if [[ -f ".venv/bin/activate" ]]; then
  source .venv/bin/activate
elif [[ -f "venv/bin/activate" ]]; then
  source venv/bin/activate
else
  echo "Python virtualenv not found in backend/.venv or backend/venv"
  exit 1
fi

if [[ "$MODE" == "prod" ]]; then
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 &
else
  uvicorn app.main:app --reload --port 8000 &
fi
BACKEND_PID=$!
cd ..

# Start Frontend
echo "Starting Frontend (${MODE})..."
cd frontend
if [[ "$MODE" == "prod" ]]; then
  npm run build
  npm run start &
else
  npm run dev &
fi
FRONTEND_PID=$!

# Handle shutdown
trap "kill $BACKEND_PID $FRONTEND_PID; exit" SIGINT SIGTERM

wait
