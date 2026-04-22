#!/bin/bash
set -euo pipefail

MODE="${1:-dev}"

if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "Usage: ./start_app.sh [dev|prod]"
  exit 1
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
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 &
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
