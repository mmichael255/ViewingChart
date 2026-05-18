import logging
import asyncio
import requests
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional
from datetime import datetime
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ── Quality financial RSS feeds confirmed live as of 2026-05 ──
# CNBC and CryptoSlate block automated requests; not included.
RSS_FEEDS = [
    # General markets
    {"source": "Bloomberg",   "url": "https://feeds.bloomberg.com/markets/news.rss"},
    {"source": "MarketWatch", "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories"},
    {"source": "Yahoo Finance","url": "https://finance.yahoo.com/news/rssindex"},
    {"source": "Investing.com","url": "https://www.investing.com/rss/news.rss"},
    {"source": "FXStreet",    "url": "https://www.fxstreet.com/rss/news"},
    {"source": "Seeking Alpha","url": "https://seekingalpha.com/market_currents.xml"},
    # Crypto
    {"source": "CoinDesk",     "url": "https://www.coindesk.com/arc/outboundfeeds/rss/"},
    {"source": "CoinTelegraph","url": "https://cointelegraph.com/rss"},
    {"source": "Decrypt",      "url": "https://decrypt.co/feed"},
]

# Respectful User-Agent (some feeds block default python-requests UA)
HEADERS = {
    "User-Agent": "ViewingChart/1.0 (financial charting app; +https://github.com)"
}


class NewsService:

    def __init__(self):
        self._session = requests.Session()
        self._session.headers.update(HEADERS)

    async def get_latest_news(self, limit_per_feed: int = 5) -> List[Dict[str, Any]]:
        """
        Fetch latest news from all RSS feeds.
        Returns deduplicated list ordered by recency (newest first).
        """
        seen_titles = set()
        news_items: List[Dict[str, Any]] = []

        for feed in RSS_FEEDS:
            try:
                items = self._fetch_feed(feed["source"], feed["url"], limit_per_feed)
                for item in items:
                    key = item["title"].strip().lower()[:120]  # dedup by first 120 chars
                    if key not in seen_titles:
                        seen_titles.add(key)
                        news_items.append(item)
            except Exception as e:
                logger.warning(f"RSS feed {feed['source']}: {e}")

        # Sort by published_at descending (newest first); items without date go last
        def sort_key(item: Dict) -> float:
            dt = item.get("_parsed_dt")
            return dt.timestamp() if dt else 0

        news_items.sort(key=sort_key, reverse=True)

        # Strip internal sort field before returning
        for item in news_items:
            item.pop("_parsed_dt", None)

        return news_items

    def _fetch_feed(self, source: str, url: str, limit: int) -> List[Dict[str, Any]]:
        """Fetch and parse a single RSS feed. Returns list of normalized dicts."""
        response = self._session.get(url, timeout=10, allow_redirects=True)

        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")

        root = ET.fromstring(response.content)

        items = []
        for elem in root.findall(".//item")[:limit]:
            title_el = elem.find("title")
            link_el = elem.find("link")
            pubdate_el = elem.find("pubDate")
            desc_el = elem.find("description")

            title = title_el.text if title_el is not None and title_el.text else "No Title"
            link = link_el.text if link_el is not None and link_el.text else "#"
            pub_date = pubdate_el.text if pubdate_el is not None and pubdate_el.text else ""
            description = desc_el.text if desc_el is not None and desc_el.text else ""

            # Parse date for sorting
            parsed_dt = self._parse_rss_date(pub_date)

            items.append({
                "source": source,
                "title": title.strip(),
                "url": link.strip(),
                "published_at": pub_date.strip(),
                "description": description.strip()[:300],  # truncate for display
                "sentiment": "Neutral",  # placeholder — Phase 2 Finnhub will fill this
                "_parsed_dt": parsed_dt,
            })

        return items

    @staticmethod
    def _parse_rss_date(date_str: str) -> datetime | None:
        """Try common RSS date formats."""
        if not date_str:
            return None
        formats = [
            "%a, %d %b %Y %H:%M:%S %z",   # RFC 2822: Mon, 18 May 2026 08:00:00 GMT
            "%a, %d %b %Y %H:%M:%S %Z",
            "%Y-%m-%dT%H:%M:%S%z",        # ISO 8601
            "%Y-%m-%dT%H:%M:%SZ",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except (ValueError, OverflowError):
                continue
        return None

    # ── Phase 2: Enriched news with Finnhub + NewsAPI ──

    async def get_enriched_news(self) -> List[Dict[str, Any]]:
        """RSS feeds + Finnhub general news + NewsAPI business headlines."""
        from app.services.finnhub_provider import finnhub_provider
        from app.services.newsapi_provider import newsapi_provider

        # Fetch all sources concurrently
        rss_task = self.get_latest_news()
        finnhub_task = finnhub_provider.get_news(category="general", limit=8)
        newsapi_task = newsapi_provider.top_headlines(category="business", limit=8)

        results = await asyncio.gather(
            rss_task, finnhub_task, newsapi_task, return_exceptions=True,
        )

        rss_news: list = results[0] if not isinstance(results[0], BaseException) else []
        finnhub_news: list = results[1] if not isinstance(results[1], BaseException) else []
        newsapi_news: list = results[2] if not isinstance(results[2], BaseException) else []

        # Combine and dedup
        seen = set()
        result: List[Dict[str, Any]] = []
        for item in rss_news + finnhub_news + newsapi_news:
            key = item["title"].strip().lower()[:120]
            if key not in seen:
                seen.add(key)
                _parsed = item.pop("_parsed_dt", None)
                if _parsed:
                    item["_parsed_dt"] = _parsed
                result.append(item)

        # Sort (RSS items have _parsed_dt from earlier; Finnhub/NewsAPI use string dates)
        def _sort_key(item: Dict) -> float:
            dt = item.get("_parsed_dt")
            if dt:
                return dt.timestamp()
            # Try parsing published_at string for Finnhub/NewsAPI items
            pub = item.get("published_at", "")
            parsed = self._parse_rss_date(pub)
            return parsed.timestamp() if parsed else 0

        result.sort(key=_sort_key, reverse=True)
        for item in result:
            item.pop("_parsed_dt", None)

        return result

    async def get_symbol_news(self, symbol: str) -> List[Dict[str, Any]]:
        """Per-symbol news: Finnhub company news + NewsAPI keyword search."""
        from app.services.finnhub_provider import finnhub_provider
        from app.services.newsapi_provider import newsapi_provider

        finnhub_task = finnhub_provider.get_company_news(symbol, limit=5)
        newsapi_task = newsapi_provider.search(query=symbol, limit=5)

        results = await asyncio.gather(
            finnhub_task, newsapi_task, return_exceptions=True,
        )

        f_news: list = results[0] if not isinstance(results[0], BaseException) else []
        n_news: list = results[1] if not isinstance(results[1], BaseException) else []

        # Combine, dedup by title
        seen = set()
        result: List[Dict[str, Any]] = []
        for item in f_news + n_news:
            key = item["title"].strip().lower()[:120]
            if key not in seen:
                seen.add(key)
                result.append(item)

        return result

    async def get_social_sentiment(self, symbol: str) -> Dict[str, Any]:
        """Finnhub Reddit + Twitter sentiment summary."""
        from app.services.finnhub_provider import finnhub_provider
        return await finnhub_provider.get_social_sentiment(symbol)


news_service = NewsService()