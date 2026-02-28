import os
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
