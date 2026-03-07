import os
import itertools
import redis.asyncio as redis
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Settings:
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
    BINANCE_WS_URL = os.getenv("BINANCE_WS_URL", "wss://stream.binance.com:9443/ws")
    BINANCE_FUTURES_WS_URL = os.getenv("BINANCE_FUTURES_WS_URL", "wss://fstream.binance.com")
    BINANCE_API_URL = os.getenv("BINANCE_API_URL", "https://api.binance.com/api/v3")
    BINANCE_FUTURES_API_URL = os.getenv("BINANCE_FUTURES_API_URL", "https://fapi.binance.com/fapi/v1")
    ALPHA_VANTAGE_API_KEY = os.getenv("ALPHAVANTAGE_API_KEY", "demo")
    ALPHA_VANTAGE_BASE_URL = os.getenv("ALPHA_VANTAGE_BASE_URL", "https://www.alphavantage.co/query")
    YAHOO_SEARCH_URL = os.getenv("YAHOO_SEARCH_URL", "https://query2.finance.yahoo.com/v1/finance/search")
    YAHOO_TRENDING_URL = os.getenv("YAHOO_TRENDING_URL", "https://query2.finance.yahoo.com/v1/finance/trending/US")
    ITICK_API_URL = os.getenv("ITICK_API_URL", "https://api.itick.org")
    ITICK_API_TOKEN = os.getenv("ITICK_API_TOKEN", "")


settings = Settings()

# ── Shared Redis connection pool (Fix #2.1) ──
# All services share the same pool instead of opening independent connections.
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

# ── Global monotonic ID counter for WS subscribe/unsubscribe (Fix #3.2) ──
ws_id_counter = itertools.count(1)
