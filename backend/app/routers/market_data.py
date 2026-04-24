import asyncio
import json
import logging
import time
from typing import Literal
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Request
from slowapi import Limiter
from app.rate_limit_key import rate_limit_client_ip
from app.services.binance_service import binance_service
from app.services.stock_service import stock_service
from app.services.klines_db_service import get_klines_db_first
from app.services.websocket_manager import manager
from app.config import VALID_INTERVALS, VALID_ASSET_TYPES, SYMBOL_PATTERN, MAX_SYMBOLS_PER_REQUEST, MAX_SEARCH_QUERY_LENGTH

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=rate_limit_client_ip)

router = APIRouter(
    prefix="/market",
    tags=["market"]
)


# ── Validation helpers ──

def validate_symbol(symbol: str) -> str:
    """Validate and normalize a market symbol."""
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.match(symbol):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid symbol '{symbol}'. Must be 1-20 alphanumeric characters (plus =./%-)"
        )
    return symbol


def validate_interval(interval: str) -> str:
    """Validate interval is one of the allowed values."""
    if interval not in VALID_INTERVALS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid interval '{interval}'. Must be one of: {', '.join(sorted(VALID_INTERVALS))}"
        )
    return interval


def validate_asset_type(asset_type: str) -> str:
    """Validate asset_type is one of the allowed values."""
    if asset_type not in VALID_ASSET_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid asset_type '{asset_type}'. Must be one of: {', '.join(sorted(VALID_ASSET_TYPES))}"
        )
    return asset_type


def parse_symbol_list(raw: str) -> list[str]:
    """Parse and validate a comma-separated list of symbols."""
    if not raw or not raw.strip():
        return []
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]
    if len(symbols) > MAX_SYMBOLS_PER_REQUEST:
        raise HTTPException(
            status_code=422,
            detail=f"Too many symbols. Maximum is {MAX_SYMBOLS_PER_REQUEST} per request."
        )
    for s in symbols:
        if not SYMBOL_PATTERN.match(s):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid symbol '{s}'. Must be 1-20 alphanumeric characters."
            )
    return symbols


# ── WebSocket endpoints (no rate limit — persistent connections) ──

@router.websocket("/ws/tickers")
async def websocket_tickers(websocket: WebSocket):
    await manager.connect_tickers(websocket)
    hb_task = asyncio.create_task(_ticker_ws_heartbeat(websocket))
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("action") == "subscribe":
                    symbols = msg.get("symbols", [])
                    # Validate each symbol in the subscribe message
                    valid_symbols = []
                    for s in symbols:
                        s = s.strip().upper()
                        if SYMBOL_PATTERN.match(s):
                            valid_symbols.append(s)
                        else:
                            logger.warning(f"WS ticker: rejected invalid symbol '{s}'")
                    await manager.subscribe_tickers(websocket, valid_symbols)
            except json.JSONDecodeError:
                logger.warning("WS ticker: received non-JSON message")
            except Exception as e:
                logger.error(f"WS ticker: error processing message: {e}")
    except WebSocketDisconnect as e:
        logger.warning(f"WS ticker disconnected gracefully: code={e.code}, reason={e.reason}")
    except Exception as e:
        logger.error(f"WS ticker disconnected unexpectedly: {e}")
    finally:
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass
        await manager.disconnect_tickers(websocket)


async def _ticker_ws_heartbeat(websocket: WebSocket) -> None:
    """Ping clients on an interval so foreground watchdogs reset without ticker traffic."""
    while True:
        await asyncio.sleep(25)
        try:
            await websocket.send_json({"type": "heartbeat", "ts": int(time.time())})
        except Exception:
            return


async def _kline_ws_heartbeat(websocket: WebSocket) -> None:
    """Keep client connections alive when Binance kline updates are sparse (e.g. 1d)."""
    while True:
        await asyncio.sleep(25)
        try:
            await websocket.send_json({"type": "heartbeat", "ts": int(time.time())})
        except Exception:
            return


@router.websocket("/ws/{symbol}/{interval}")
async def websocket_endpoint(websocket: WebSocket, symbol: str, interval: str):
    # Validate params before accepting the connection
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.match(symbol):
        await websocket.close(code=1008, reason=f"Invalid symbol: {symbol}")
        return
    if interval not in VALID_INTERVALS:
        await websocket.close(code=1008, reason=f"Invalid interval: {interval}")
        return

    await manager.connect(websocket, symbol, interval)
    hb_task = asyncio.create_task(_kline_ws_heartbeat(websocket))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect as e:
        logger.warning(f"WS kline {symbol}@{interval} disconnected gracefully: code={e.code}, reason={e.reason}")
    except Exception as e:
        logger.error(f"WS kline {symbol}@{interval} disconnected unexpectedly: {e}")
    finally:
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass
        manager.disconnect(websocket, symbol, interval)


# ── REST endpoints ──

@router.get("/klines/{symbol}")
@limiter.limit("30/minute")
async def get_klines(
    request: Request,
    symbol: str,
    interval: str = Query(default="1d", description="Candle interval"),
    asset_type: str = Query(default="crypto", description="Asset type: crypto or stock"),
):
    """Get historical k-lines for a symbol."""
    symbol = validate_symbol(symbol)
    interval = validate_interval(interval)
    asset_type = validate_asset_type(asset_type)

    data = await get_klines_db_first(
        symbol, bar_interval=interval, asset_type=asset_type, limit=5000
    )

    if not data:
        raise HTTPException(status_code=404, detail="Data not found or error fetching data")
    return data


@router.get("/tickers")
async def get_tickers(
    request: Request,
    crypto_symbols: str = Query(default="", description="Comma-separated crypto symbols"),
    stock_symbols: str = Query(default="", description="Comma-separated stock symbols"),
    force_refresh: bool = Query(
        default=False,
        description="If true, skip Redis quote cache (use for client resync after stale feed)",
    ),
):
    """Get current price and 24h change for a list of symbols."""
    c_list = parse_symbol_list(crypto_symbols)
    s_list = parse_symbol_list(stock_symbols)

    results = {}

    if c_list:
        c_data = await binance_service.get_ticker_24h(c_list, use_cache=not force_refresh)
        results.update(c_data)

    if s_list:
        s_data = await stock_service.get_quotes(s_list, use_cache=not force_refresh)
        results.update(s_data)

    return results


@router.get("/search")
@limiter.limit("20/minute")
async def search_markets(
    request: Request,
    query: str = Query(default="", max_length=MAX_SEARCH_QUERY_LENGTH, description="Search term"),
    asset_type: str = Query(default="crypto", description="Asset type: crypto or stock"),
):
    """Search for market symbols by query string."""
    asset_type = validate_asset_type(asset_type)
    query = query.strip()

    if not query:
        raise HTTPException(status_code=422, detail="Search query cannot be empty")

    if asset_type == "crypto":
        return await binance_service.search_symbols(query)
    else:
        return await stock_service.search_symbols(query)


@router.get("/popular")
async def get_popular(request: Request):
    """Get dynamic popular cryptos and trending stocks."""
    crypto = await binance_service.get_popular_cryptos()
    stocks = await stock_service.get_popular_stocks()
    return {"crypto": crypto, "stock": stocks}
