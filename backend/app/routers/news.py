import logging
from fastapi import APIRouter, Query

from app.services.news_service import news_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/news",
    tags=["news"]
)


@router.get("/")
async def get_news():
    """Legacy: RSS-only news. Use /news/enriched for full feed."""
    return await news_service.get_latest_news()


@router.get("/enriched")
async def get_enriched_news():
    """Full news: RSS feeds + Finnhub + NewsAPI business headlines."""
    return await news_service.get_enriched_news()


@router.get("/symbol/{symbol}")
async def get_symbol_news(symbol: str):
    """Per-symbol news via Finnhub + NewsAPI keyword search."""
    return await news_service.get_symbol_news(symbol.upper())


@router.get("/sentiment/{symbol}")
async def get_social_sentiment(symbol: str):
    """Finnhub Reddit + Twitter sentiment for a symbol."""
    return await news_service.get_social_sentiment(symbol.upper())