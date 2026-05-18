"""
Finnhub API provider: news, sentiment, insider trading, SEC filings.

API docs: https://finnhub.io/docs/api
Free tier: 60 calls/min. Key required in .env as FINNHUB_API_KEY.
"""

import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"


class FinnhubProvider:
    """Wraps Finnhub REST API. Gracefully degrades when key is missing."""

    def __init__(self) -> None:
        self._key = settings.FINNHUB_API_KEY
        self._enabled = bool(self._key and self._key.strip())
        if not self._enabled:
            logger.info("Finnhub: no API key — provider disabled")

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def get_news(
        self, category: str = "general", limit: int = 10
    ) -> List[Dict[str, Any]]:
        """General market news. Categories: general, forex, crypto, merger."""
        if not self._enabled:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{FINNHUB_BASE}/news",
                    params={"category": category, "token": self._key},
                )
                r.raise_for_status()
                raw = r.json()
        except Exception as e:
            logger.warning(f"Finnhub news ({category}): {e}")
            return []

        items = []
        for item in raw[:limit]:
            items.append({
                "source": f"Finnhub ({item.get('source', '?')})",
                "title": item.get("headline", "No Title"),
                "url": item.get("url", "#"),
                "published_at": self._ts_to_str(item.get("datetime")),
                "description": (item.get("summary", "") or "")[:300],
                "sentiment": "Neutral",  # Finnhub doesn't provide sentiment on news
                "category": item.get("category", category),
                "related_symbols": item.get("related", ""),
            })
        return items

    async def get_company_news(
        self, symbol: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Per-symbol news. Supports stocks and crypto (e.g. AAPL, BTC)."""
        if not self._enabled:
            return []
        try:
            # Finnhub demands from/to dates. Use last 7 days.
            from_date = datetime.now().strftime("%Y-%m-%d")
            to_date = datetime.now().strftime("%Y-%m-%d")
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{FINNHUB_BASE}/company-news",
                    params={
                        "symbol": symbol.upper(),
                        "from": from_date,
                        "to": to_date,
                        "token": self._key,
                    },
                )
                r.raise_for_status()
                raw = r.json()
        except Exception as e:
            logger.warning(f"Finnhub company-news ({symbol}): {e}")
            return []

        items = []
        for item in raw[:limit]:
            items.append({
                "source": f"Finnhub ({item.get('source', '?')})",
                "title": item.get("headline", "No Title"),
                "url": item.get("url", "#"),
                "published_at": self._ts_to_str(item.get("datetime")),
                "description": (item.get("summary", "") or "")[:300],
                "sentiment": "Neutral",
                "category": item.get("category", ""),
                "related_symbols": item.get("related", ""),
            })
        return items

    async def get_social_sentiment(
        self, symbol: str
    ) -> Dict[str, Any]:
        """Reddit + Twitter sentiment for a symbol."""
        if not self._enabled:
            return {"symbol": symbol, "reddit": [], "twitter": []}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{FINNHUB_BASE}/stock/social-sentiment",
                    params={"symbol": symbol.upper(), "token": self._key},
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning(f"Finnhub sentiment ({symbol}): {e}")
            return {"symbol": symbol, "reddit": [], "twitter": []}

        # Summarize: average bullish ratio across recent mentions
        def _summarize(entries: list, source: str) -> Dict:
            if not entries:
                return {"source": source, "mentions": 0, "bullish_pct": 0}
            total = len(entries)
            bullish = sum(
                1 for e in entries
                if str(e.get("sentiment", "")).lower() in {"bullish", "positive"}
            )
            return {
                "source": source,
                "mentions": total,
                "bullish_pct": round((bullish / total) * 100, 1) if total else 0,
            }

        return {
            "symbol": symbol,
            "reddit": _summarize(data.get("reddit", []), "Reddit"),
            "twitter": _summarize(data.get("twitter", []), "Twitter"),
        }

    @staticmethod
    def _ts_to_str(ts: Optional[int]) -> str:
        if not ts:
            return ""
        try:
            return datetime.fromtimestamp(ts).strftime("%a, %d %b %Y %H:%M:%S GMT")
        except Exception:
            return ""


# Singleton
finnhub_provider = FinnhubProvider()