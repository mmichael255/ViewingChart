"""
CoinGecko provider: crypto fundamentals (market cap, supply, volume, high/low, ATH, ATL).

API docs: https://docs.coingecko.com/reference/coins-id
Free tier: ~30 calls/min, no API key required.
"""

import json
import logging
from typing import Any, Dict, Optional

import httpx

from app.config import settings, get_redis

logger = logging.getLogger(__name__)

# Mapping from our symbol format to CoinGecko API coin ID
BINANCE_TO_COINGECKO: dict[str, Optional[str]] = {
    "BTCUSDT": "bitcoin",
    "ETHUSDT": "ethereum",
    "SOLUSDT": "solana",
    "XRPUSDT": "ripple",
    "ADAUSDT": "cardano",
    "DOGEUSDT": "dogecoin",
    "DOTUSDT": "polkadot",
    "LINKUSDT": "chainlink",
    "AVAXUSDT": "avalanche-2",
    "MATICUSDT": "matic-network",
    "BNBUSDT": "binancecoin",
    "LTCUSDT": "litecoin",
    "XAUUSDT": None,
    "XAGUSDT": None,
}

# Routing table: futures-only symbols → enrichment source.
# Add a new line here when adding a futures symbol that needs enrichment.
FUTURES_ENRICHMENT_CONFIG: dict[str, str] = {
    # Crypto (CoinGecko)
    "BTCUSDT": "coingecko",
    "ETHUSDT": "coingecko",
    "SOLUSDT": "coingecko",
    "XRPUSDT": "coingecko",
    "ADAUSDT": "coingecko",
    "DOGEUSDT": "coingecko",
    "DOTUSDT": "coingecko",
    "LINKUSDT": "coingecko",
    "AVAXUSDT": "coingecko",
    "MATICUSDT": "coingecko",
    "BNBUSDT": "coingecko",
    "LTCUSDT": "coingecko",
    # Precious metals (Alpha Vantage FX)
    "XAUUSDT": "alphavantage_fx",
    "XAGUSDT": "alphavantage_fx",
}

TTL_SECONDS = 300  # 5 min cache


class CoinGeckoProvider:
    """Wraps CoinGecko REST API for crypto fundamental data."""

    def __init__(self) -> None:
        self.redis_client = get_redis()
        self.http = httpx.AsyncClient(timeout=10.0)

    async def close(self) -> None:
        await self.http.aclose()

    async def get_coin_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch fundamental data for a crypto symbol. Returns None on failure or not found."""
        coin_id = BINANCE_TO_COINGECKO.get(symbol.upper())
        if not coin_id:
            return None

        cache_key = f"coingecko:coin:{coin_id}"
        try:
            cached = await self.redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

        url = f"{settings.COINGECKO_BASE_URL}/coins/{coin_id}"
        params = {
            "localization": "false",
            "tickers": "false",
            "community_data": "false",
            "developer_data": "false",
        }
        try:
            resp = await self.http.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            market = data.get("market_data", {})

            result = {
                "marketCap": market.get("market_cap", {}).get("usd"),
                "fullyDilutedValuation": market.get("fully_diluted_valuation", {}).get("usd"),
                "totalVolume": market.get("total_volume", {}).get("usd"),
                "high24h": market.get("high_24h", {}).get("usd"),
                "low24h": market.get("low_24h", {}).get("usd"),
                "circulatingSupply": market.get("circulating_supply"),
                "totalSupply": market.get("total_supply"),
                "maxSupply": market.get("max_supply"),
                "ath": market.get("ath", {}).get("usd"),
                "atl": market.get("atl", {}).get("usd"),
                "genesisDate": data.get("genesis_date"),
                "marketCapRank": data.get("market_cap_rank"),
            }
            await self.redis_client.setex(cache_key, TTL_SECONDS, json.dumps(result))
            return result
        except Exception as e:
            logger.warning(f"CoinGecko fetch failed for {coin_id}: {e}")
            return None


# Singleton
coingecko_provider = CoinGeckoProvider()