from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.services.binance_service import binance_service
from app.services.stock_service import stock_service
from app.services.websocket_manager import manager
import asyncio

router = APIRouter(
    prefix="/market",
    tags=["market"]
)

@router.on_event("startup")
async def startup_event():
    # Start Binance stream in background
    asyncio.create_task(manager.start_binance_stream())

@router.websocket("/ws/{symbol}/{interval}")
async def websocket_endpoint(websocket: WebSocket, symbol: str, interval: str):
    await manager.connect(websocket, symbol, interval)
    try:
        while True:
            # Keep connection alive, maybe listen for client pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, symbol, interval)

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
