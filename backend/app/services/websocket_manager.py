import asyncio
import json
import logging
import websockets
import redis.asyncio as redis
from typing import List, Dict, Set
from fastapi import WebSocket
from app.config import settings, get_redis, ws_id_counter

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
        # Shared Redis pool (Fix #2.1)
        self.redis = get_redis()
        self.binance_spot_ws = None
        self.binance_futures_ws = None
        self.subscribed_streams: Set[str] = set()
        # Reference count: how many clients are watching each stream
        self._stream_refcount: Dict[str, int] = {}
        # Symbol lists, loaded once at startup
        self._futures_only_syms: Set[str] = set()
        self._spot_syms: Set[str] = set()
        # Track which individual ticker streams are subscribed (Fix #3.3)
        self._subscribed_ticker_streams: Dict[str, Set[str]] = {"spot": set(), "futures": set()}

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
                # Unsubscribe from Binance if nobody is watching — awaited properly (Fix #3.2)
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
                        "id": next(ws_id_counter),  # Fix #3.2 — monotonic ID
                    }
                    await ws.send(json.dumps(payload))
                    logger.info(f"[{tag}] Dynamic Unsubscribe: {stream_name}")
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

        old_syms = self.global_watchlist_syms
        self.global_watchlist_syms = new_syms

        # Fix #3.3 — dynamically subscribe/unsubscribe per-symbol ticker streams
        added = new_syms - old_syms
        removed = old_syms - new_syms
        if added or removed:
            await self._update_ticker_streams(added, removed)

    def disconnect_tickers(self, websocket: WebSocket):
        if websocket in self.ticker_connections:
            self.ticker_connections.remove(websocket)
        if websocket in self.ticker_subscriptions:
            del self.ticker_subscriptions[websocket]
        logger.info("Client disconnected from global ticker stream")

    # ── Per-symbol ticker stream management (Fix #3.3) ────────────────

    async def _update_ticker_streams(self, added: Set[str], removed: Set[str]):
        """Subscribe/unsubscribe individual <symbol>@ticker streams instead of !ticker@arr."""
        for sym in added:
            stream = f"{sym.lower()}@ticker"
            is_spot = sym.lower() in self._spot_syms
            tag = "SPOT" if is_spot else "FUTURES"
            ws = self.binance_spot_ws if is_spot else self.binance_futures_ws
            target_set = self._subscribed_ticker_streams["spot" if is_spot else "futures"]

            if ws and stream not in target_set:
                try:
                    payload = {"method": "SUBSCRIBE", "params": [stream], "id": next(ws_id_counter)}
                    await ws.send(json.dumps(payload))
                    target_set.add(stream)
                    logger.info(f"[{tag}] ✅ Ticker subscribe: {stream}")
                except Exception as e:
                    logger.error(f"Failed to subscribe ticker {stream}: {e}")

        for sym in removed:
            stream = f"{sym.lower()}@ticker"
            is_spot = sym.lower() in self._spot_syms
            tag = "SPOT" if is_spot else "FUTURES"
            ws = self.binance_spot_ws if is_spot else self.binance_futures_ws
            target_set = self._subscribed_ticker_streams["spot" if is_spot else "futures"]

            if ws and stream in target_set:
                try:
                    payload = {"method": "UNSUBSCRIBE", "params": [stream], "id": next(ws_id_counter)}
                    await ws.send(json.dumps(payload))
                    target_set.discard(stream)
                    logger.info(f"[{tag}] ❌ Ticker unsubscribe: {stream}")
                except Exception as e:
                    logger.error(f"Failed to unsubscribe ticker {stream}: {e}")

    async def _subscribe_initial_ticker_streams(self):
        """Subscribe the initial watchlist symbols as individual ticker streams."""
        for sym in self.global_watchlist_syms:
            stream = f"{sym.lower()}@ticker"
            is_spot = sym.lower() in self._spot_syms
            ws = self.binance_spot_ws if is_spot else self.binance_futures_ws
            target_set = self._subscribed_ticker_streams["spot" if is_spot else "futures"]
            if ws and stream not in target_set:
                try:
                    payload = {"method": "SUBSCRIBE", "params": [stream], "id": next(ws_id_counter)}
                    await ws.send(json.dumps(payload))
                    target_set.add(stream)
                except Exception as e:
                    logger.error(f"Failed initial ticker subscribe {stream}: {e}")
        logger.info(f"Subscribed {len(self.global_watchlist_syms)} initial ticker streams")

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
                        await self.broadcast_ticker(data)

                    elif channel == "market:kline":
                        symbol = data["symbol"]
                        interval = data["interval"]
                        update = data["data"]
                        logger.debug(f"Broadcasting KLINE -> {symbol.upper()}@{interval} (close: {update['close']})")
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
                                    "id": next(ws_id_counter),  # Fix #3.2 — monotonic ID
                                }
                                try:
                                    await ws.send(json.dumps(payload))
                                    self.subscribed_streams.add(stream_name)
                                    logger.info(f"[{tag}] Dynamic Subscribe: {stream_name}")
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

                        added = new_syms - self.global_watchlist_syms
                        removed = self.global_watchlist_syms - new_syms
                        self.global_watchlist_syms = new_syms

                        if added or removed:
                            await self._update_ticker_streams(added, removed)

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
                logger.warning(f"[{tag}] No streams to connect, sleeping...")
                await asyncio.sleep(30)
                continue

            stream_string = "/".join(streams)
            url = f"{base_url}/stream?streams={stream_string}"
            logger.info(f"[{tag}] Connecting to WS with {len(streams)} streams...")
            logger.debug(f"[{tag}] URL: {url[:120]}...")
            logger.info(f"Connecting to {tag} WS ({len(streams)} streams)")

            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20, close_timeout=10) as ws:
                    logger.info(f"[{tag}] WebSocket connected!")
                    if is_spot:
                        self.binance_spot_ws = ws
                    else:
                        self.binance_futures_ws = ws

                    # Subscribe initial ticker streams once connected (Fix #3.3)
                    await self._subscribe_initial_ticker_streams()

                    msg_count = 0
                    while self.running:
                        # Fix #3.1 — timeout on recv to detect zombie connections
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=30)
                        except asyncio.TimeoutError:
                            logger.warning(f"[{tag}] No data received in 30s, reconnecting...")
                            logger.warning(f"[{tag}] Zombie connection detected, reconnecting...")
                            break  # exits inner loop; outer loop reconnects

                        raw_data = json.loads(msg)
                        data = raw_data.get("data", raw_data)
                        msg_count += 1

                        # Handle individual ticker updates (Fix #3.3 — <symbol>@ticker format)
                        if isinstance(data, dict) and "e" in data and data["e"] == "24hrTicker":
                            s = data["s"]
                            if s in self.global_watchlist_syms:
                                update = {
                                    s: {
                                        "lastPrice": float(data["c"]),
                                        "priceChange": float(data["p"]),
                                        "priceChangePercent": float(data["P"]),
                                    }
                                }
                                await self.redis.publish("market:ticker", json.dumps(update))
                            continue

                        # Handle ticker array (!ticker@arr) — kept as fallback
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
                                if msg_count % 10 == 1:
                                    syms = list(updates.keys())[:5]
                                    logger.debug(f"[{tag}] Ticker update #{msg_count}: {syms} ({len(updates)} symbols)")
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
                            logger.debug(f"[{tag}] Kline -> {symbol.upper()}@{interval}: close={formatted_update['close']}")

            except Exception as e:
                logger.error(f"[{tag}] WS error: {e}")
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
                    logger.info(f"Loaded {len(self._spot_syms)} spot and {len(self._futures_only_syms)} futures symbols from Redis")
                    logger.info(f"Loaded {len(self._spot_syms)} spot and {len(self._futures_only_syms)} futures symbols from Redis")
                    return
                else:
                    logger.info(f"Symbol lists empty, retrying ({attempt+1}/10)...")
            except Exception as e:
                logger.error(f"Failed to load symbol lists: {e}")
                logger.error(f"Failed to load symbol lists from Redis: {e}")
            await asyncio.sleep(2)

        # Hardcoded fallback for known symbols
        self._futures_only_syms = {"xauusdt", "xagusdt"}
        self._spot_syms = {"btcusdt", "ethusdt", "solusdt"}
        logger.warning("Could not load symbol lists from Redis, using fallback")

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

        # Fix #3.3 — Start light with NO !ticker@arr; individual ticker streams
        # are subscribed dynamically after connection via _subscribe_initial_ticker_streams()
        spot_streams: List[str] = []
        futures_streams: List[str] = []

        for s in self.subscribed_streams:
            base_sym = s.split("@")[0].lower()
            if base_sym in self._spot_syms:
                spot_streams.append(s)
            else:
                futures_streams.append(s)

        # Need at least one stream for the initial connection URL to be valid;
        # use a single default kline stream as a seed if nothing else is subscribed
        if not spot_streams:
            seed = "btcusdt@kline_1d"
            spot_streams.append(seed)
            self.subscribed_streams.add(seed)
        if not futures_streams:
            seed = "xauusdt@kline_1d"
            futures_streams.append(seed)
            self.subscribed_streams.add(seed)

        logger.info(f"Spot streams: {len(spot_streams)} | Futures streams: {len(futures_streams)}")

        # Launch independent tasks — one crash doesn't kill the other
        asyncio.create_task(self._run_stream_loop(spot_ws_base, spot_streams, is_spot=True))
        asyncio.create_task(self._run_stream_loop(futures_ws_base, futures_streams, is_spot=False))

        # Keep the coroutine alive so the startup task doesn't exit
        while self.running:
            await asyncio.sleep(60)


manager = ConnectionManager()
