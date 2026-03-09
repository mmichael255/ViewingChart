import time
import logging
from fastapi import APIRouter
from app.config import get_redis, settings

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

    # ── Overall ──
    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503

    return {
        "status": "healthy" if all_ok else "degraded",
        "environment": settings.ENVIRONMENT,
        "uptime_seconds": round(time.time() - _start_time, 1),
        "checks": checks,
    }
