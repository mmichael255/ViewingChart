import asyncio
import json
import logging
import websockets
import redis.asyncio as redis
from typing import List, Dict, Set
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
        self.global_watchlist_syms: Set[str] = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}
        # Default watchlist anchors that should never be removed
        self._default_watchlist_syms: Set[str] = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}

        self.binance_ws_url = settings.BINANCE_WS_URL
        self.running = False
        self.redis = redis.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0, decode_responses=True
        )
        self.binance_spot_ws = None
        self.binance_futures_ws = None
        self.subscribed_streams: Set[str] = set()
        # Reference count: how many clients are watching each stream
        self._stream_refcount: Dict[str, int] = {}
        # Symbol lists, loaded once at startup
        self._futures_only_syms: Set[str] = set()
        self._spot_syms: Set[str] = set()

    # ── Client connection management ──────────────────────────────────

    async def connect(self, websocket: WebSocket, symbol: str, interval: str):
        await websocket.accept()
        key = f"{symbol.lower()}_{interval}"
        if key not in self.active_connections:
            self.active_connections[key] = []
        self.active_connections[key].append(websocket)
        logger.info(f"Client connected to {key}. Total: {len(self.active_connections[key])}")

        stream_name = f"{symbol.lower()}@kline_{interval}"
        self._stream_refcount[stream_name] = self._stream_refcount.get(stream_name, 0) + 1

        if stream_name not in self.subscribed_streams:
            await self.redis.publish("market:cmd_kline_sub", json.dumps({"stream": stream_name}))

    def disconnect(self, websocket: WebSocket, symbol: str, interval: str):
        key = f"{symbol.lower()}_{interval}"
        if key in self.active_connections:
            if websocket in self.active_connections[key]:
                self.active_connections[key].remove(websocket)
            if not self.active_connections[key]:
                del self.active_connections[key]

        stream_name = f"{symbol.lower()}@kline_{interval}"
        if stream_name in self._stream_refcount:
            self._stream_refcount[stream_name] -= 1
            if self._stream_refcount[stream_name] <= 0:
                del self._stream_refcount[stream_name]
                # Unsubscribe from Binance if nobody is watching
                asyncio.ensure_future(self._unsubscribe_stream(stream_name))

        logger.info(f"Client disconnected from {key}")

    async def _unsubscribe_stream(self, stream_name: str):
        """Send UNSUBSCRIBE to the live Binance WS and remove from tracked set."""
        if stream_name in self.subscribed_streams:
            self.subscribed_streams.discard(stream_name)
            base_sym = stream_name.split("@")[0].lower()
            is_spot = base_sym in self._spot_syms
            ws = self.binance_spot_ws if is_spot else self.binance_futures_ws
            tag = "SPOT" if is_spot else "FUTURES"
            if ws:
                try:
                    payload = {
                        "method": "UNSUBSCRIBE",
                        "params": [stream_name],
                        "id": len(self.subscribed_streams) + 100,
                    }
                    await ws.send(json.dumps(payload))
                    print(f"[{tag}] ❌ Dynamic Unsubscribe: {stream_name}")
                    logger.info(f"Unsubscribed from Binance WS: {stream_name}")
                except Exception as e:
                    logger.error(f"Failed to unsubscribe {stream_name}: {e}")

    async def connect_tickers(self, websocket: WebSocket):
        await websocket.accept()
        self.ticker_connections.append(websocket)
        self.ticker_subscriptions[websocket] = set()
        logger.info(f"Client connected to global ticker stream. Total: {len(self.ticker_connections)}")

    async def subscribe_tickers(self, websocket: WebSocket, symbols: List[str]):
        if websocket in self.ticker_subscriptions:
            self.ticker_subscriptions[websocket] = set(s.upper() for s in symbols)

        # Rebuild the global set from all active subscriptions + defaults
        new_syms = set(self._default_watchlist_syms)
        for sub_set in self.ticker_subscriptions.values():
            new_syms.update(sub_set)
        self.global_watchlist_syms = new_syms

        if symbols:
            await self.redis.publish("market:cmd_ticker_sub", json.dumps({"symbols": symbols}))

    def disconnect_tickers(self, websocket: WebSocket):
        if websocket in self.ticker_connections:
            self.ticker_connections.remove(websocket)
        if websocket in self.ticker_subscriptions:
            del self.ticker_subscriptions[websocket]
        logger.info("Client disconnected from global ticker stream")

    # ── Broadcasting ──────────────────────────────────────────────────

    async def broadcast_ticker(self, message: dict):
        # Iterate over a COPY to avoid mutation during iteration
        for connection in list(self.ticker_connections):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting ticker to client: {e}")
                self.disconnect_tickers(connection)

    async def broadcast(self, symbol: str, interval: str, message: dict):
        key = f"{symbol.lower()}_{interval}"
        if key in self.active_connections:
            # Iterate over a COPY to avoid mutation during iteration
            for connection in list(self.active_connections.get(key, [])):
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to client: {e}")
                    self.disconnect(connection, symbol, interval)

    # ── Redis Listener ────────────────────────────────────────────────

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
                        # print(f"📡 Broadcasting TICKER updates to clients ({len(data)} symbols)")
                        await self.broadcast_ticker(data)

                    elif channel == "market:kline":
                        symbol = data["symbol"]
                        interval = data["interval"]
                        update = data["data"]
                        print(f"📡 Broadcasting KLINE to clients -> {symbol.upper()}@{interval} (close: {update['close']})")
                        await self.broadcast(symbol, interval, update)

                    elif channel == "market:cmd_kline_sub":
                        stream_name = data.get("stream")
                        if stream_name and stream_name not in self.subscribed_streams:
                            base_sym = stream_name.split("@")[0].lower()
                            is_spot = base_sym in self._spot_syms
                            ws = self.binance_spot_ws if is_spot else self.binance_futures_ws
                            tag = "SPOT" if is_spot else "FUTURES"
                            if ws:
                                payload = {
                                    "method": "SUBSCRIBE",
                                    "params": [stream_name],
                                    "id": len(self.subscribed_streams) + 1,
                                }
                                try:
                                    await ws.send(json.dumps(payload))
                                    self.subscribed_streams.add(stream_name)
                                    print(f"[{tag}] ✅ Dynamic Subscribe: {stream_name}")
                                    logger.info(f"Dynamically subscribed to Binance WS: {stream_name}")
                                except Exception as e:
                                    logger.error(f"Failed to dynamic subscribe to {stream_name}: {e}")

                    elif channel == "market:cmd_ticker_sub":
                        tickers = data.get("symbols", [])
                        # Rebuild watchlist from all active subscriptions + new ones
                        new_syms = set(self._default_watchlist_syms)
                        new_syms.update(t.upper() for t in tickers)
                        for sub_set in self.ticker_subscriptions.values():
                            new_syms.update(sub_set)
                        self.global_watchlist_syms = new_syms
                        logger.info(f"Global watchlist updated: {len(self.global_watchlist_syms)} symbols tracked.")

        except asyncio.CancelledError:
            await pubsub.unsubscribe()
        except Exception as e:
            logger.error(f"Redis Pub/Sub Error: {e}")

    # ── Binance Stream Runners ────────────────────────────────────────

    async def _run_stream_loop(self, base_url: str, streams: List[str], is_spot: bool = True):
        """
        Independent reconnect loop for a single Binance endpoint (Spot or Futures).
        Each endpoint manages its own lifecycle so one crash doesn't affect the other.
        """
        tag = "SPOT" if is_spot else "FUTURES"
        while self.running:
            if not streams:
                print(f"[{tag}] No streams to connect, sleeping...")
                await asyncio.sleep(30)
                continue

            stream_string = "/".join(streams)
            url = f"{base_url}/stream?streams={stream_string}"
            print(f"[{tag}] Connecting to WS with {len(streams)} streams...")
            print(f"[{tag}] URL: {url[:120]}...")
            logger.info(f"Connecting to {tag} WS ({len(streams)} streams)")

            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20, close_timeout=10) as ws:
                    print(f"[{tag}] ✅ WebSocket connected!")
                    if is_spot:
                        self.binance_spot_ws = ws
                    else:
                        self.binance_futures_ws = ws

                    msg_count = 0
                    while self.running:
                        msg = await ws.recv()
                        raw_data = json.loads(msg)
                        data = raw_data.get("data", raw_data)
                        msg_count += 1

                        # Handle ticker array (!ticker@arr)
                        if isinstance(data, list):
                            updates = {}
                            for item in data:
                                s = item["s"]
                                if s in self.global_watchlist_syms:
                                    updates[s] = {
                                        "lastPrice": float(item["c"]),
                                        "priceChange": float(item["p"]),
                                        "priceChangePercent": float(item["P"]),
                                    }
                            if updates:
                                await self.redis.publish("market:ticker", json.dumps(updates))
                                # Log every 10th ticker batch to avoid spam
                                if msg_count % 10 == 1:
                                    syms = list(updates.keys())[:5]
                                    print(f"[{tag}] 📊 Ticker update #{msg_count}: {syms} ({len(updates)} symbols)")
                            continue

                        # Handle kline streams
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
                                "volume": float(kline["v"]),
                            }

                            payload = {
                                "symbol": symbol,
                                "interval": interval,
                                "data": formatted_update,
                            }
                            await self.redis.publish("market:kline", json.dumps(payload))
                            # Log every kline update as requested
                            print(f"[{tag}] 🕯️  Kline Fetched -> {symbol.upper()}@{interval}: open={formatted_update['open']} close={formatted_update['close']} vol={formatted_update['volume']}")

            except Exception as e:
                print(f"[{tag}] ❌ WS error: {e}")
                logger.error(f"{tag} WS error: {e}")
                await asyncio.sleep(5)

    async def _load_symbols(self):
        """Load spot and futures symbol names from Redis. Retries until populated."""
        for attempt in range(10):
            try:
                futures = await self.redis.smembers("binance:futures_list")
                spot = await self.redis.smembers("binance:spot_list")
                if futures and spot:
                    self._futures_only_syms = {m.lower() for m in futures}
                    self._spot_syms = {m.lower() for m in spot}
                    print(f"[INIT] ✅ Loaded {len(self._spot_syms)} spot and {len(self._futures_only_syms)} futures symbols from Redis")
                    logger.info(f"Loaded {len(self._spot_syms)} spot and {len(self._futures_only_syms)} futures symbols from Redis")
                    return
                else:
                    print(f"[INIT] ⏳ Symbol lists empty, retrying ({attempt+1}/10)...")
            except Exception as e:
                print(f"[INIT] ❌ Failed to load symbol lists: {e}")
                logger.error(f"Failed to load symbol lists from Redis: {e}")
            await asyncio.sleep(2)
        
        # Hardcoded fallback for known symbols
        self._futures_only_syms = {"xauusdt", "xagusdt"}
        self._spot_syms = {"btcusdt", "ethusdt", "solusdt"}
        print(f"[INIT] ⚠️  Could not load symbol lists, using fallback")

    async def start_binance_stream(self):
        """
        Background task to start Binance WebSocket streams and publish to Redis.
        Spot and Futures run in independent tasks with their own reconnect loops.
        """
        self.running = True

        # Start the local Redis subscriber
        asyncio.create_task(self.redis_listener())

        # Give binance_service a moment to populate the futures list on first boot
        await asyncio.sleep(2)
        await self._load_symbols()

        spot_ws_base = self.binance_ws_url.replace("/ws", "")
        futures_ws_base = settings.BINANCE_FUTURES_WS_URL

        # Start light: just subscribe to the ticker array
        self.subscribed_streams.add("!ticker@arr")

        # Split streams between spot and futures
        spot_streams = ["!ticker@arr"]
        futures_streams = ["!ticker@arr"]

        for s in self.subscribed_streams:
            if s == "!ticker@arr":
                continue
            base_sym = s.split("@")[0].lower()
            if base_sym in self._spot_syms:
                spot_streams.append(s)
            else:
                futures_streams.append(s)

        print(f"[INIT] Spot streams: {len(spot_streams)} | Futures streams: {len(futures_streams)}")

        # Launch independent tasks — one crash doesn't kill the other
        asyncio.create_task(self._run_stream_loop(spot_ws_base, spot_streams, is_spot=True))
        asyncio.create_task(self._run_stream_loop(futures_ws_base, futures_streams, is_spot=False))

        # Keep the coroutine alive so the startup task doesn't exit
        while self.running:
            await asyncio.sleep(60)


manager = ConnectionManager()
