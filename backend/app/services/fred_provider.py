"""
FRED (Federal Reserve Economic Data) provider.

Free API, instant key: https://fred.stlouisfed.org/docs/api/api_key.html
Key required in .env as FRED_API_KEY.
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred"

# Key series we track
FRED_SERIES = {
    "fed_funds":      "DFF",        # Federal Funds Effective Rate (daily, %)
    "us2y":           "DGS2",       # 2-Year Treasury
    "us5y":           "DGS5",       # 5-Year Treasury
    "us10y":          "DGS10",      # 10-Year Treasury
    "us30y":          "DGS30",      # 30-Year Treasury
    "spread_2s10s":   "T10Y2Y",    # 10Y-2Y spread
    "dxy":            "DTWEXBGS",   # Trade-Weighted USD Index (broad)
    "gdp":            "GDP",        # Gross Domestic Product (quarterly)
    "cpi":            "CPIAUCSL",   # Consumer Price Index (monthly)
    "unemployment":   "UNRATE",     # Unemployment Rate (monthly, %)
    "m2":             "M2SL",       # M2 Money Supply (monthly)
    "fed_assets":     "WALCL",      # Fed Total Assets (weekly)
}

# TTL for FRED data in Redis (seconds) — economic data changes slowly
FRED_CACHE_TTL = 3600  # 1 hour


class FredProvider:
    """Wraps FRED REST API."""

    def __init__(self) -> None:
        self._key = settings.FRED_API_KEY
        self._enabled = bool(self._key and self._key.strip())
        if not self._enabled:
            logger.info("FRED: no API key — provider disabled")

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def get_latest(self, series_id: str) -> Dict[str, Any]:
        """Get the single most recent observation for a series."""
        if not self._enabled:
            return {"series_id": series_id, "value": None, "date": None}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{FRED_BASE}/series/observations",
                    params={
                        "series_id": series_id,
                        "api_key": self._key,
                        "file_type": "json",
                        "sort_order": "desc",
                        "limit": 1,
                    },
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning(f"FRED {series_id}: {e}")
            return {"series_id": series_id, "value": None, "date": None}

        obs = data.get("observations", [])
        if not obs:
            return {"series_id": series_id, "value": None, "date": None}
        o = obs[0]
        return {
            "series_id": series_id,
            "value": float(o["value"]) if o.get("value") and o["value"] != "." else None,
            "date": o.get("date"),
        }

    async def get_history(
        self, series_id: str, limit: int = 90
    ) -> List[Dict[str, Any]]:
        """Get recent observations for a series (for charting)."""
        if not self._enabled:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{FRED_BASE}/series/observations",
                    params={
                        "series_id": series_id,
                        "api_key": self._key,
                        "file_type": "json",
                        "sort_order": "desc",
                        "limit": limit,
                    },
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning(f"FRED history {series_id}: {e}")
            return []

        result = []
        for o in data.get("observations", []):
            val = o.get("value")
            if val and val != ".":
                result.append({
                    "date": o.get("date"),
                    "value": float(val),
                })
        result.reverse()  # oldest first for charting
        return result

    async def get_dashboard(self) -> Dict[str, Any]:
        """Fetch all key indicators concurrently."""
        indicators = ["fed_funds", "us2y", "us5y", "us10y", "us30y",
                      "spread_2s10s", "dxy", "unemployment", "cpi"]
        results = {}
        for name in indicators:
            sid = FRED_SERIES[name]
            results[name] = await self.get_latest(sid)
        return results

    async def get_yield_curve(self, days: int = 365) -> Dict[str, Any]:
        """Get 2Y and 10Y history for yield curve charting."""
        import asyncio
        d2y, d10y = await asyncio.gather(
            self.get_history(FRED_SERIES["us2y"], limit=days),
            self.get_history(FRED_SERIES["us10y"], limit=days),
            return_exceptions=True,
        )
        if isinstance(d2y, BaseException):
            d2y = []
        if isinstance(d10y, BaseException):
            d10y = []
        return {"us2y": d2y, "us10y": d10y}


# Singleton
fred_provider = FredProvider()