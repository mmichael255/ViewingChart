import asyncio
import json
import logging
import websockets
import redis.asyncio as redis
from typing import List, Dict
from fastapi import WebSocket
from app.config import settings

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Map "symbol_interval" -> List of WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # List of WebSockets listening to all tickers
        self.ticker_connections: List[WebSocket] = []
        self.ticker_subscriptions: Dict[WebSocket, set] = {}
        self.global_watchlist_syms = set(["BTCUSDT", "ETHUSDT", "SOLUSDT"])
        
        self.binance_ws_url = settings.BINANCE_WS_URL
        self.running = False
        self.redis = redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0, decode_responses=True)
        self.binance_ws = None
        self.subscribed_streams = set()

    async def connect(self, websocket: WebSocket, symbol: str, interval: str):
        await websocket.accept()
        key = f"{symbol.lower()}_{interval}"
        if key not in self.active_connections:
            self.active_connections[key] = []
        self.active_connections[key].append(websocket)
        logger.info(f"Client connected to {key}. Total: {len(self.active_connections[key])}")
        
        stream_name = f"{symbol.lower()}@kline_{interval}"
        if stream_name not in self.subscribed_streams:
            await self.redis.publish("market:cmd_kline_sub", json.dumps({"stream": stream_name}))

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
        self.ticker_subscriptions[websocket] = set()
        logger.info(f"Client connected to global ticker stream. Total: {len(self.ticker_connections)}")

    async def subscribe_tickers(self, websocket: WebSocket, symbols: List[str]):
        if websocket in self.ticker_subscriptions:
            self.ticker_subscriptions[websocket] = set(s.upper() for s in symbols)
            
        if symbols:
            await self.redis.publish("market:cmd_ticker_sub", json.dumps({"symbols": symbols}))

    def disconnect_tickers(self, websocket: WebSocket):
        if websocket in self.ticker_connections:
            self.ticker_connections.remove(websocket)
        if websocket in self.ticker_subscriptions:
            del self.ticker_subscriptions[websocket]
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

    async def redis_listener(self):
        """
        Background task to consume from Redis Pub/Sub and broadcast locally.
        Allows multiple server instances to share data from one Binance streamer.
        """
        pubsub = self.redis.pubsub()
        await pubsub.subscribe("market:ticker", "market:kline", "market:cmd_kline_sub", "market:cmd_ticker_sub")
        logger.info("Subscribed to Redis Pub/Sub channels")
        
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    channel = message["channel"]
                    data = json.loads(message["data"])
                    
                    if channel == "market:ticker":
                        await self.broadcast_ticker(data)
                    elif channel == "market:kline":
                        symbol = data["symbol"]
                        interval = data["interval"]
                        update = data["data"]
                        await self.broadcast(symbol, interval, update)
                    elif channel == "market:cmd_kline_sub":
                        stream_name = data.get("stream")
                        if stream_name and stream_name not in self.subscribed_streams and self.binance_ws:
                            payload = {
                                "method": "SUBSCRIBE",
                                "params": [stream_name],
                                "id": len(self.subscribed_streams) + 1
                            }
                            try:
                                await self.binance_ws.send(json.dumps(payload))
                                self.subscribed_streams.add(stream_name)
                                logger.info(f"Dynamically Subscribed to Binance WS: {stream_name}")
                            except Exception as e:
                                logger.error(f"Failed to dynamic subscribe to {stream_name}: {e}")
                                
                    elif channel == "market:cmd_ticker_sub":
                        tickers = data.get("symbols", [])
                        self.global_watchlist_syms.update(t.upper() for t in tickers)
                        logger.info(f"Global dynamic watchlist updated: {len(self.global_watchlist_syms)} tracking.")
        except asyncio.CancelledError:
            await pubsub.unsubscribe()
        except Exception as e:
            print(f"CRITICAL REDIS LISTENER ERROR: {repr(e)}")
            logger.error(f"Redis Pub/Sub Error: {e}")

    async def _run_stream(self, base_url: str, streams: List[str]):
        if not streams:
            return
            
        stream_string = "/".join(streams)
        url = f"{base_url}/stream?streams={stream_string}"
        print(f"Connecting to Binance WS for {len(streams)} streams at {url}")
        
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=20, close_timeout=10) as ws:
                # Store the main spot websocket for dynamic subscribing
                if "fstream" not in base_url:
                    self.binance_ws = ws
                    
                while self.running:
                    msg = await ws.recv()
                    raw_data = json.loads(msg)
                    data = raw_data.get("data", raw_data)
                    
                    if isinstance(data, list):
                        updates = {}
                        for item in data:
                            s = item["s"]
                            if s in self.global_watchlist_syms:
                                updates[s] = {
                                    "lastPrice": float(item["c"]),
                                    "priceChange": float(item["p"]),
                                    "priceChangePercent": float(item["P"])
                                }
                        if updates:
                            await self.redis.publish("market:ticker", json.dumps(updates))
                        continue

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
                        
                        payload = {
                            "symbol": symbol,
                            "interval": interval,
                            "data": formatted_update
                        }
                        await self.redis.publish("market:kline", json.dumps(payload))
        except Exception as e:
            print(f"CRITICAL BINANCE WS ERROR url={url}: {repr(e)}")
            logger.error(f"Binance WebSocket Error: {e}")
            await asyncio.sleep(5)

    async def start_binance_stream(self):
        """
        Background task to consume Binance WebSocket streams and publish to Redis.
        """
        self.running = True
        
        # Start the local Redis subscriber
        asyncio.create_task(self.redis_listener())
        
        spot_ws_base = self.binance_ws_url.replace("/ws", "")
        futures_ws_base = settings.BINANCE_FUTURES_WS_URL
        
        while self.running:
            try:
                streams = list(self.subscribed_streams)
                if not streams:
                    symbols = ["btcusdt", "ethusdt", "solusdt", "xauusdt", "xagusdt"]
                    intervals = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
                    for s in symbols:
                        for i in intervals:
                            streams.append(f"{s}@kline_{i}")
                            self.subscribed_streams.add(f"{s}@kline_{i}")
                
                if "!ticker@arr" not in streams:
                    streams.append("!ticker@arr")
                    self.subscribed_streams.add("!ticker@arr")
                    
                spot_streams = []
                futures_streams = []
                
                for s in streams:
                    if s.startswith("xau") or s.startswith("xag"):
                        futures_streams.append(s)
                    else:
                        spot_streams.append(s)
                
                # Run connection loops concurrently
                tasks = [
                    self._run_stream(spot_ws_base, spot_streams),
                    self._run_stream(futures_ws_base, futures_streams)
                ]
                await asyncio.gather(*tasks)

            except Exception as e:
                print(f"General Stream Loop Error: {repr(e)}")
                await asyncio.sleep(5)

manager = ConnectionManager()
