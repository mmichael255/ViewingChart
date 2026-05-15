import os
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from app.config import get_redis, settings
from app.services.stock_service import stock_service
from app.services.websocket_manager import manager
from app.auth.deps import require_superadmin

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

_start_time = time.time()


@router.get("/health")
async def health_check():
    """
    Health check endpoint — verifies critical dependencies.
    Returns 200 if healthy, 503 if any critical dependency is down.
    """
    checks = {}

    # ── Redis ──
    try:
        r = get_redis()
        pong = await r.ping()
        checks["redis"] = "ok" if pong else "error"
    except Exception as e:
        checks["redis"] = f"error: {e}"
        logger.error(f"Health check — Redis unreachable: {e}")

    # ── Binance WS ──
    ws_status = manager.get_status()
    checks["binance_spot_ws"] = "ok" if ws_status["spot_connected"] else "disconnected"
    checks["binance_futures_ws"] = "ok" if ws_status["futures_connected"] else "disconnected"

    # ── Overall ──
    all_ok = all(v == "ok" for v in checks.values())

    return {
        "status": "healthy" if all_ok else "degraded",
        "environment": settings.ENVIRONMENT,
        "uptime_seconds": round(time.time() - _start_time, 1),
        "checks": checks,
        "binance_ws": ws_status,
    }


@router.get("/ws/status")
async def ws_status(_=Depends(require_superadmin)):
    """Real-time WebSocket metrics: connection state, reconnect counts, message rates, client counts."""
    status = manager.get_status()
    status["uptime_seconds"] = round(time.time() - _start_time, 1)
    stock_metrics = stock_service.get_metrics_snapshot()
    status["stock_quote_metrics"] = stock_metrics
    status["stock_regular_only_mode"] = stock_metrics.get("regular_only_mode_enabled", False)
    return status


@router.get("/scheduler/log")
async def scheduler_log(
    lines: int = Query(100, ge=1, le=1000),
    date: str | None = Query(None, description="Date in YYYY-MM-DD format for historical logs"),
    _=Depends(require_superadmin),
):
    """Return the last N lines from the kline scheduler log file.

    By default reads today's active log file. Pass ?date=YYYY-MM-DD to
    read a rotated log from a specific day (e.g. scheduler.log.2026-05-14).
    """
    base_path = os.getenv("KLINE_SCHEDULER_LOG_PATH", "logs/scheduler.log")
    log_path = f"{base_path}.{date}" if date else base_path
    if not os.path.isfile(log_path):
        raise HTTPException(status_code=404, detail="Scheduler log file not found")
    try:
        with open(log_path, "r") as f:
            all_lines = f.readlines()
        tail = all_lines[-lines:]
        return {
            "path": log_path,
            "lines": [l.rstrip("\n") for l in tail],
            "total_lines": len(all_lines),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log: {e}")
