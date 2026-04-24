import asyncio
import time
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from slowapi import Limiter, _rate_limit_exceeded_handler
from app.rate_limit_key import rate_limit_client_ip
from slowapi.errors import RateLimitExceeded

from app.config import settings, validate_secrets
from app.logging_config import setup_logging
from app.errors import (
    validation_exception_handler,
    http_exception_handler,
    unhandled_exception_handler,
    error_response,
)

# ── Initialize logging before anything else ──
setup_logging()
logger = logging.getLogger(__name__)

# ── Rate limiter ──
limiter = Limiter(key_func=rate_limit_client_ip, default_limits=[settings.RATE_LIMIT])


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: start background tasks on startup, clean up on shutdown."""
    from app.services.websocket_manager import manager
    from app.services.binance_service import binance_service
    from app.services.stock_service import stock_service

    # Validate secrets and log config summary
    validate_secrets()

    logger.info("Starting Binance stream manager...")
    task = asyncio.create_task(manager.start_binance_stream())
    logger.info("ViewingChart backend is ready.")
    yield
    # Graceful shutdown
    logger.info("Shutting down...")
    manager.running = False
    task.cancel()
    await binance_service.close()
    await stock_service.close()
    logger.info("Shutdown complete.")


app = FastAPI(
    title="ViewingChart API",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Attach the limiter to the app ──
app.state.limiter = limiter

# ── Register error handlers ──
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS — uses configurable origins ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request logging middleware ──
@app.middleware("http")
async def request_logger(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000

    # Only log non-WS, non-health requests to keep logs clean
    path = request.url.path
    if not path.startswith("/health") and "ws" not in path and path != "/metrics":
        logger.info(
            f"{request.method} {path} → {response.status_code} ({duration_ms:.1f}ms)"
        )

    return response


# ── Import & register routers ──
from app.routers import market_data, chat, news
from app.routers import health as health_router
from app.routers import metrics_prometheus
from app.database.connection import engine
from app.database import models

# Create tables
models.Base.metadata.create_all(bind=engine)

# API v1 — versioned routes
app.include_router(market_data.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(news.router, prefix="/api/v1")

# Health check — mounted at both /api/v1/health and /health (for LB probes)
app.include_router(health_router.router, prefix="/api/v1")
app.include_router(health_router.router)

# Prometheus scrape — stable path for scrapers (not under /api/v1)
app.include_router(metrics_prometheus.router)


@app.get("/")
def read_root():
    return {"message": "ViewingChart API is running", "docs": "/docs", "health": "/health"}
