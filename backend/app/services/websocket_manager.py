import asyncio
import json
import logging
import websockets
from typing import List, Dict
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Map "symbol_interval" -> List of WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # List of WebSockets listening to all tickers
        self.ticker_connections: List[WebSocket] = []
        self.binance_ws_url = "wss://stream.binance.com:9443/ws"
        self.running = False

    async def connect(self, websocket: WebSocket, symbol: str, interval: str):
        await websocket.accept()
        key = f"{symbol.lower()}_{interval}"
        if key not in self.active_connections:
            self.active_connections[key] = []
        self.active_connections[key].append(websocket)
        logger.info(f"Client connected to {key}. Total: {len(self.active_connections[key])}")

    def disconnect(self, websocket: WebSocket, symbol: str, interval: str):
        key = f"{symbol.lower()}_{interval}"
        if key in self.active_connections:
            if websocket in self.active_connections[key]:
                self.active_connections[key].remove(websocket)
            if not self.active_connections[key]:
                del self.active_connections[key]
        logger.info(f"Client disconnected from {key}")

    async def connect_tickers(self, websocket: WebSocket):
        await websocket.accept()
        self.ticker_connections.append(websocket)
        logger.info(f"Client connected to global ticker stream. Total: {len(self.ticker_connections)}")

    def disconnect_tickers(self, websocket: WebSocket):
        if websocket in self.ticker_connections:
            self.ticker_connections.remove(websocket)
        logger.info("Client disconnected from global ticker stream")

    async def broadcast_ticker(self, message: dict):
        for connection in self.ticker_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting ticker to client: {e}")
                self.disconnect_tickers(connection)

    async def broadcast(self, symbol: str, interval: str, message: dict):
        key = f"{symbol.lower()}_{interval}"
        if key in self.active_connections:
            for connection in self.active_connections[key]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to client: {e}")
                    # Cleanup dead connection
                    self.disconnect(connection, symbol, interval)

    async def start_binance_stream(self):
        """
        Background task to consume Binance WebSocket stream.
        """
        self.running = True
        while self.running:
            try:
                # 1. Kline streams for specific charts
                symbols = ["btcusdt", "ethusdt", "solusdt"]
                intervals = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
                
                streams = []
                for s in symbols:
                    for i in intervals:
                        streams.append(f"{s}@kline_{i}")
                
                # 2. Add global ticker stream for watchlist
                streams.append("!ticker@arr")
                
                stream_string = "/".join(streams)
                url = f"{self.binance_ws_url}/{stream_string}"
                
                logger.info(f"Connecting to Binance WS for {len(streams)} streams")
                
                async with websockets.connect(url) as ws:
                    while self.running:
                        msg = await ws.recv()
                        data = json.loads(msg)
                        
                        # Handle array of tickers (!ticker@arr)
                        if isinstance(data, list):
                            # Filter only the ones we care about for brevity in broadcast
                            # Or just broadcast the whole thing if frontend handles it
                            watchlist_syms = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
                            updates = {}
                            for item in data:
                                s = item["s"]
                                if s in watchlist_syms:
                                    updates[s] = {
                                        "lastPrice": float(item["c"]),
                                        "priceChange": float(item["p"]),
                                        "priceChangePercent": float(item["P"])
                                    }
                            if updates:
                                await self.broadcast_ticker(updates)
                            continue

                        # Handle individual streams (klines)
                        if "k" in data:
                            kline = data["k"]
                            symbol = data["s"].lower()
                            interval = kline["i"]
                            
                            formatted_update = {
                                "time": kline["t"] // 1000,
                                "open": float(kline["o"]),
                                "high": float(kline["h"]),
                                "low": float(kline["l"]),
                                "close": float(kline["c"]),
                                "volume": float(kline["v"])
                            }
                            await self.broadcast(symbol, interval, formatted_update)
                            
            except Exception as e:
                logger.error(f"Binance WebSocket Error: {e}")
                await asyncio.sleep(5)

manager = ConnectionManager()
