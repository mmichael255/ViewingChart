from fastapi import APIRouter, HTTPException
from app.services.binance_service import binance_service
from app.services.stock_service import stock_service

router = APIRouter(
    prefix="/market",
    tags=["market"]
)

@router.get("/klines/{symbol}")
async def get_klines(symbol: str, interval: str = "1d", asset_type: str = "crypto"):
    """
    Get historical k-lines.
    asset_type: 'crypto' (Binance) or 'stock' (Yahoo)
    """
    if asset_type == "stock":
        # Map intervals if necessary, yfinance uses 1d, 1h, etc. matching lightweight charts mostly
        data = stock_service.get_klines(symbol, interval=interval)
    else:
        data = binance_service.get_klines(symbol, interval=interval, limit=1000)
        
    if not data:
        raise HTTPException(status_code=404, detail="Data not found or error fetching data")
    return data
