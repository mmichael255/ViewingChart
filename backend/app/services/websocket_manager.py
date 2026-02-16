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
        Optimized to restart connection on failure.
        """
        self.running = True
        while self.running:
            try:
                # Subscribe to all Binance-supported intervals for BTC, ETH, SOL
                symbols = ["btcusdt", "ethusdt", "solusdt"]
                
                # All Binance supported intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
                intervals = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
                
                streams = []
                for s in symbols:
                    for i in intervals:
                        streams.append(f"{s}@kline_{i}")
                
                # Binance stream URL format: /ws/stream1/stream2...
                # Note: There's a limit to URL length. For many streams, use Combined Streams endpoint logic
                # or create multiple connections. For this demo (3 symbols * 7 intervals = 21 streams), URL might work.
                stream_string = "/".join(streams)
                url = f"{self.binance_ws_url}/{stream_string}"
                
                logger.info(f"Connecting to Binance WS for {len(streams)} streams")
                
                async with websockets.connect(url) as ws:
                    while self.running:
                        msg = await ws.recv()
                        data = json.loads(msg)
                        
                        # Parse Binance Format
                        # { "e": "kline", "E": 123456789, "s": "BTCUSDT", "k": { "i": "1d", ... } }
                        if "k" in data:
                            kline = data["k"]
                            symbol = data["s"].lower()
                            interval = kline["i"]
                            
                            # Format for Lightweight Charts
                            formatted_update = {
                                "time": kline["t"] // 1000, # Milliseconds to Seconds
                                "open": float(kline["o"]),
                                "high": float(kline["h"]),
                                "low": float(kline["l"]),
                                "close": float(kline["c"]),
                                "volume": float(kline["v"])
                            }
                            
                            await self.broadcast(symbol, interval, formatted_update)
                            
            except Exception as e:
                logger.error(f"Binance WebSocket Error: {e}")
                await asyncio.sleep(5) # Wait before reconnecting

manager = ConnectionManager()
