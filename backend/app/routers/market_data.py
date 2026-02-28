import json
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.services.binance_service import binance_service
from app.services.stock_service import stock_service
from app.services.websocket_manager import manager

router = APIRouter(
    prefix="/market",
    tags=["market"]
)

# NOTE: Startup is now handled via lifespan in main.py (no more @router.on_event)

@router.websocket("/ws/tickers")
async def websocket_tickers(websocket: WebSocket):
    await manager.connect_tickers(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("action") == "subscribe":
                    symbols = msg.get("symbols", [])
                    await manager.subscribe_tickers(websocket, symbols)
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect_tickers(websocket)

@router.websocket("/ws/{symbol}/{interval}")
async def websocket_endpoint(websocket: WebSocket, symbol: str, interval: str):
    await manager.connect(websocket, symbol, interval)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, symbol, interval)

@router.get("/klines/{symbol}")
async def get_klines(symbol: str, interval: str = "1d", asset_type: str = "crypto"):
    """
    Get historical k-lines.
    asset_type: 'crypto' (Binance) or 'stock' (iTick)
    """
    # Futures (XAU/XAG) are treated as crypto because Binance provides them
    if asset_type == "stock" and not (symbol.startswith("XAU") or symbol.startswith("XAG")):
        data = await stock_service.get_klines(symbol, interval=interval)
    else:
        data = await binance_service.get_klines(symbol, interval=interval, limit=1000)
        
    if not data:
        raise HTTPException(status_code=404, detail="Data not found or error fetching data")
    return data

@router.get("/tickers")
async def get_tickers(crypto_symbols: str = "", stock_symbols: str = ""):
    """
    Get current price and 24h change for a list of symbols.
    Example: /market/tickers?crypto_symbols=BTCUSDT,ETHUSDT&stock_symbols=AAPL,TSLA
    """
    results = {}
    
    # Fetch Crypto Tickers
    if crypto_symbols:
        c_list = [s.strip() for s in crypto_symbols.split(",") if s.strip()]
        if c_list:
            c_data = await binance_service.get_ticker_24h(c_list)
            results.update(c_data)
            
    # Fetch Stock Quotes
    if stock_symbols:
        s_list = [s.strip() for s in stock_symbols.split(",") if s.strip()]
        if s_list:
            s_data = await stock_service.get_quotes(s_list)
            results.update(s_data)
            
    return results

@router.get("/search")
async def search_markets(query: str, asset_type: str = "crypto"):
    """Search for market symbols by query string."""
    if asset_type == "crypto":
        return await binance_service.search_symbols(query)
    else:
        return await stock_service.search_symbols(query)

@router.get("/popular")
async def get_popular():
    """Get dynamic popular cryptos from Binance and trending stocks from Yahoo Finance."""
    crypto = await binance_service.get_popular_cryptos()
    stocks = await stock_service.get_popular_stocks()
    return {"crypto": crypto, "stock": stocks}
