import os
import re
import itertools
import logging
import redis.asyncio as redis
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)


class Settings:
    # ── Environment ──
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
    CORS_ORIGINS = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    RATE_LIMIT = os.getenv("RATE_LIMIT", "60/minute")

    # ── Redis ──
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))

    # ── Binance ──
    BINANCE_WS_URL = os.getenv("BINANCE_WS_URL", "wss://stream.binance.com:9443/ws")
    BINANCE_FUTURES_WS_URL = os.getenv("BINANCE_FUTURES_WS_URL", "wss://fstream.binance.com")
    BINANCE_API_URL = os.getenv("BINANCE_API_URL", "https://api.binance.com/api/v3")
    BINANCE_FUTURES_API_URL = os.getenv("BINANCE_FUTURES_API_URL", "https://fapi.binance.com/fapi/v1")

    # ── External APIs ──
    ALPHA_VANTAGE_API_KEY = os.getenv("ALPHAVANTAGE_API_KEY", "demo")
    ALPHA_VANTAGE_BASE_URL = os.getenv("ALPHA_VANTAGE_BASE_URL", "https://www.alphavantage.co/query")
    YAHOO_SEARCH_URL = os.getenv("YAHOO_SEARCH_URL", "https://query2.finance.yahoo.com/v1/finance/search")
    YAHOO_TRENDING_URL = os.getenv("YAHOO_TRENDING_URL", "https://query2.finance.yahoo.com/v1/finance/trending/US")
    ITICK_API_URL = os.getenv("ITICK_API_URL", "https://api.itick.org")
    ITICK_API_TOKEN = os.getenv("ITICK_API_TOKEN", "")

    # ── Database ──
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "viewingchart")

    # ── OpenAI ──
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


settings = Settings()


# ── Secrets validation (warn, don't crash) ──

def mask_secret(value: str, visible: int = 4) -> str:
    """Mask a secret string, showing only the first and last `visible` chars."""
    if not value or len(value) <= visible * 2:
        return "***"
    return f"{value[:visible]}...{value[-visible:]}"


def validate_secrets():
    """Log warnings for missing or placeholder secrets at startup."""
    warnings = []

    if not settings.ALPHA_VANTAGE_API_KEY or settings.ALPHA_VANTAGE_API_KEY == "demo":
        warnings.append("ALPHAVANTAGE_API_KEY is not set or is 'demo'. Alpha Vantage will be rate-limited.")

    if not settings.OPENAI_API_KEY:
        warnings.append("OPENAI_API_KEY is not set. Chat will run in mock mode.")

    if not settings.ITICK_API_TOKEN:
        warnings.append("ITICK_API_TOKEN is not set.")

    if settings.DB_PASSWORD in ("", "test123"):
        warnings.append("DB_PASSWORD is empty or default. Use a strong password in production.")

    for w in warnings:
        logger.warning(f"[CONFIG] {w}")

    # Log masked keys for debugging
    logger.info(f"[CONFIG] Environment: {settings.ENVIRONMENT}")
    logger.info(f"[CONFIG] CORS Origins: {settings.CORS_ORIGINS}")
    logger.info(f"[CONFIG] Redis: {settings.REDIS_HOST}:{settings.REDIS_PORT}")
    logger.info(f"[CONFIG] AlphaVantage key: {mask_secret(settings.ALPHA_VANTAGE_API_KEY)}")
    logger.info(f"[CONFIG] iTick token: {mask_secret(settings.ITICK_API_TOKEN)}")


# ── Shared Redis connection pool ──
redis_pool = redis.ConnectionPool(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    db=0,
    decode_responses=True,
    max_connections=20,
)


def get_redis() -> redis.Redis:
    """Return a Redis client backed by the shared pool."""
    return redis.Redis(connection_pool=redis_pool)


# ── Global monotonic ID counter for WS subscribe/unsubscribe ──
ws_id_counter = itertools.count(1)


# ── Input validation constants ──
VALID_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"}
VALID_ASSET_TYPES = {"crypto", "stock"}
SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9=./%-]{1,20}$")
MAX_SEARCH_QUERY_LENGTH = 50
MAX_SYMBOLS_PER_REQUEST = 50
