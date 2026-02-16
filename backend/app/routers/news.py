from fastapi import APIRouter, HTTPException
from app.services.news_service import news_service

router = APIRouter(
    prefix="/news",
    tags=["news"]
)

@router.get("/")
async def get_news():
    """
    Get latest finance news and social sentiment.
    """
    news = await news_service.get_latest_news()
    return news
