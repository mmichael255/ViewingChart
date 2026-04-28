import time
import logging
from fastapi import APIRouter
from app.config import get_redis, settings
from app.services.stock_service import stock_service
from app.services.websocket_manager import manager

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
async def ws_status():
    """Real-time WebSocket metrics: connection state, reconnect counts, message rates, client counts."""
    status = manager.get_status()
    status["uptime_seconds"] = round(time.time() - _start_time, 1)
    stock_metrics = stock_service.get_metrics_snapshot()
    status["stock_quote_metrics"] = stock_metrics
    status["stock_regular_only_mode"] = stock_metrics.get("regular_only_mode_enabled", False)
    return status
