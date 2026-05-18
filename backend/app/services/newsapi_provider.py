"""
NewsAPI.org provider: keyword search across 80,000+ sources.

API docs: https://newsapi.org/docs
Free tier: 100 req/day. Key required in .env as NEWSAPI_KEY.
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

NEWSAPI_BASE = "https://newsapi.org/v2"


class NewsAPIProvider:
    """Wraps NewsAPI.org. Gracefully degrades when key is missing."""

    def __init__(self) -> None:
        self._key = settings.NEWSAPI_KEY
        self._enabled = bool(self._key and self._key.strip())
        if not self._enabled:
            logger.info("NewsAPI: no API key — provider disabled")

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def search(
        self,
        query: str = "financial markets",
        limit: int = 10,
        language: str = "en",
        sort_by: str = "publishedAt",
    ) -> List[Dict[str, Any]]:
        """
        Search news by keyword. Supports complex queries:
          'BTC OR Bitcoin', 'AAPL AND earnings', 'federal reserve rate'
        """
        if not self._enabled:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{NEWSAPI_BASE}/everything",
                    params={
                        "q": query,
                        "language": language,
                        "sortBy": sort_by,
                        "pageSize": limit,
                        "apiKey": self._key,
                    },
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning(f"NewsAPI search ({query}): {e}")
            return []

        articles = data.get("articles", [])
        items = []
        for a in articles:
            items.append({
                "source": f"NewsAPI ({a.get('source', {}).get('name', '?')})",
                "title": a.get("title", "No Title") or "No Title",
                "url": a.get("url", "#") or "#",
                "published_at": a.get("publishedAt", "") or "",
                "description": (a.get("description") or "")[:300],
                "sentiment": "Neutral",
                "image_url": a.get("urlToImage"),
            })
        return items

    async def top_headlines(
        self,
        category: str = "business",
        limit: int = 10,
        country: str = "us",
    ) -> List[Dict[str, Any]]:
        """Top headlines by category. Categories: business, technology, general."""
        if not self._enabled:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{NEWSAPI_BASE}/top-headlines",
                    params={
                        "category": category,
                        "country": country,
                        "pageSize": limit,
                        "apiKey": self._key,
                    },
                )
                r.raise_for_status()
                data = r.json()
        except Exception as e:
            logger.warning(f"NewsAPI headlines ({category}): {e}")
            return []

        articles = data.get("articles", [])
        items = []
        for a in articles:
            items.append({
                "source": f"NewsAPI ({a.get('source', {}).get('name', '?')})",
                "title": a.get("title", "No Title") or "No Title",
                "url": a.get("url", "#") or "#",
                "published_at": a.get("publishedAt", "") or "",
                "description": (a.get("description") or "")[:300],
                "sentiment": "Neutral",
                "image_url": a.get("urlToImage"),
            })
        return items


# Singleton
newsapi_provider = NewsAPIProvider()