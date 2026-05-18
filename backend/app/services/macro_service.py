"""
Macro market indicators: DXY, Treasury yields, Fed Funds rate.

Primary source: FRED (free API key). Fallback: yfinance.
"""

import asyncio
import json
import logging
from typing import Any, Dict, Optional

import yfinance as yf

from app.config import get_redis

logger = logging.getLogger(__name__)

# ── Ticker map ──
TICKERS = {
    "dxy":    "DX-Y.NYB",   # US Dollar Index (ICE)
    "us3m":   "^IRX",       # 13-Week T-Bill (proxy for short-term rate)
    "us2y":   "2YY=F",      # 2-Year Yield Futures
    "us5y":   "^FVX",       # 5-Year Treasury Yield (CBOE)
    "us10y":  "^TNX",       # 10-Year Treasury Yield (CBOE)
    "us30y":  "^TYX",       # 30-Year Treasury Yield (CBOE)
    "fedfunds":"ZQ=F",      # 30-Day Fed Funds Futures → implied rate = 100 - price
}

# Redis cache TTLs (seconds)
TTL_INTRADAY = 60       # DXY, yields — change throughout the session
TTL_DAILY = 3600        # Fed rate — changes at most daily


class MacroService:
    """Fetches macro indicators with Redis caching."""

    def __init__(self):
        self._redis = get_redis()

    # ── Public API ──

    async def get_dashboard(self) -> Dict[str, Any]:
        """Full macro snapshot for the frontend dashboard."""
        dxy, yields, fed = await asyncio.gather(
            self.get_dxy(),
            self.get_yields(),
            self.get_fed_rate(),
        )
        return {
            "dxy": dxy,
            "yields": yields,
            "fed_rate": fed,
            "spread_2s10s": round(yields.get("us10y", 0) - yields.get("us2y", 0), 3),
            "spread_10y3m": round(yields.get("us10y", 0) - yields.get("us3m", 0), 3),
        }

    async def get_dxy(self) -> Dict[str, Any]:
        """DXY snapshot: price, daily change, 52-week range."""
        return await self._cached("macro:dxy", TTL_INTRADAY, self._fetch_dxy)

    async def get_yields(self) -> Dict[str, float]:
        """Current yields for 3M, 2Y, 5Y, 10Y, 30Y."""
        return await self._cached("macro:yields", TTL_INTRADAY, self._fetch_yields)

    async def get_fed_rate(self) -> Dict[str, Any]:
        """Fed Funds rate: FRED primary, ZQ=F futures as fallback."""
        return await self._cached("macro:fed_rate", TTL_DAILY, self._fetch_fed_rate)

    async def get_yield_curve_history(self, days: int = 365) -> Dict[str, Any]:
        """2Y/10Y historical data from FRED for yield curve charting."""
        from app.services.fred_provider import fred_provider
        if fred_provider.enabled:
            return await fred_provider.get_yield_curve(days=days)
        return {"us2y": [], "us10y": [], "note": "FRED API key not set"}

    async def get_economic_indicators(self) -> Dict[str, Any]:
        """Key economic data: GDP, CPI, unemployment, M2, Fed balance sheet."""
        from app.services.fred_provider import fred_provider
        if not fred_provider.enabled:
            return {"note": "FRED API key not set"}
        return await fred_provider.get_dashboard()

    # ── Cache helper ──

    async def _cached(self, key: str, ttl: int, fetcher) -> Any:
        """Return from Redis cache or fetch + cache."""
        try:
            raw = await self._redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception as e:
            logger.debug(f"Redis read error ({key}): {e}")

        data = await fetcher()
        try:
            await self._redis.setex(key, ttl, json.dumps(data))
        except Exception as e:
            logger.debug(f"Redis write error ({key}): {e}")

        return data

    # ── Fetchers: FRED primary, yfinance fallback ──

    async def _fetch_dxy(self) -> Dict[str, Any]:
        from app.services.fred_provider import fred_provider
        # Try FRED first for the Trade-Weighted USD
        if fred_provider.enabled:
            fred_data = await fred_provider.get_latest("DTWEXBGS")
            if fred_data.get("value") is not None:
                return {
                    "symbol": "DXY",
                    "name": "Trade-Weighted USD (FRED)",
                    "price": fred_data["value"],
                    "change": 0,  # FRED is daily, no intraday change
                    "change_pct": 0,
                    "high_52w": None,
                    "low_52w": None,
                    "fred_date": fred_data.get("date"),
                }
        # Fallback: yfinance DXY
        info = await self._ticker_info(TICKERS["dxy"])
        price = info.get("regularMarketPrice") or info.get("previousClose", 0)
        prev_close = info.get("previousClose", price)
        change = round(price - prev_close, 3) if prev_close else 0
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
        return {
            "symbol": "DXY",
            "name": "US Dollar Index (yfinance)",
            "price": price,
            "change": change,
            "change_pct": change_pct,
            "high_52w": info.get("fiftyTwoWeekHigh"),
            "low_52w": info.get("fiftyTwoWeekLow"),
        }

    async def _fetch_yields(self) -> Dict[str, float]:
        from app.services.fred_provider import fred_provider
        # FRED gives us accurate daily yields
        fred_map = {"us2y": "DGS2", "us5y": "DGS5", "us10y": "DGS10", "us30y": "DGS30"}
        results = {}
        if fred_provider.enabled:
            for key, sid in fred_map.items():
                d = await fred_provider.get_latest(sid)
                val = d.get("value")
                results[key] = round(float(val), 3) if val is not None else 0.0
            # us3m: FRED doesn't have a great 3-month treasury; use yfinance ^IRX
            results["us3m"] = await self._yf_yield("us3m")
            return results

        # Fallback: all yfinance
        for key in ["us3m", "us2y", "us5y", "us10y", "us30y"]:
            results[key] = await self._yf_yield(key)
        return results

    async def _fetch_fed_rate(self) -> Dict[str, Any]:
        from app.services.fred_provider import fred_provider
        # FRED DFF = actual effective Fed Funds rate
        if fred_provider.enabled:
            d = await fred_provider.get_latest("DFF")
            if d.get("value") is not None:
                return {
                    "source": "Federal Reserve (FRED DFF)",
                    "effective_rate": d["value"],
                    "date": d.get("date"),
                }
        # Fallback: ZQ=F futures (market-implied forward rate, NOT current rate)
        info = await self._ticker_info(TICKERS["fedfunds"])
        price = info.get("regularMarketPrice") or info.get("previousClose", 100)
        return {
            "source": "Fed Funds Futures (ZQ=F) — implied forward rate",
            "implied_rate": round(100 - float(price), 2),
            "futures_price": float(price),
            "note": "Set FRED_API_KEY for actual effective Fed Funds rate",
        }

    async def _yf_yield(self, key: str) -> float:
        """Fetch a single yield from yfinance, with error handling."""
        try:
            info = await self._ticker_info(TICKERS[key])
            price = info.get("regularMarketPrice") or info.get("previousClose", 0)
            return round(float(price), 3)
        except Exception:
            return 0.0

    @staticmethod
    async def _ticker_info(symbol: str) -> Dict[str, Any]:
        """Fetch yfinance Ticker.info in a thread."""
        def _get():
            t = yf.Ticker(symbol)
            return t.info
        return await asyncio.to_thread(_get)


# Singleton
macro_service = MacroService()