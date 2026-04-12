import httpx
import json
import logging
import redis.asyncio as redis
from typing import List, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import settings, get_redis

logger = logging.getLogger(__name__)


class BinanceService:
    BASE_URL = settings.BINANCE_API_URL

    def __init__(self):
        # Shared Redis pool (Fix #2.1)
        self.redis_client = get_redis()
        self.cache_duration = 3600  # 1 hour
        # Shared HTTP client — reuse TCP connections across all API calls
        self.http_client = httpx.AsyncClient(timeout=15.0)
        # In-memory cache of spot symbol names (rebuilt on exchange info fetch)
        self._spot_names_cache: set = set()

    async def close(self):
        """Gracefully close the HTTP client (Fix #1.2)."""
        await self.http_client.aclose()

    # ── Retry wrapper (Fix #1.3) ──
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, max=10),
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout)),
        reraise=True,
    )
    async def _fetch_json(self, url: str, params: dict | None = None) -> Any:
        """HTTP GET with automatic retry + exponential backoff."""
        response = await self.http_client.get(url, params=params or {})
        response.raise_for_status()
        return response.json()

    async def _fetch_exchange_info(self) -> List[Dict[str, str]]:
        """Fetch and cache trading pairs from Binance exchange info (Spot + Futures)."""
        try:
            cached = await self.redis_client.get("binance:symbols")
        except Exception as e:
            logger.debug(f"Redis get failed (binance:symbols): {e}")
            cached = None
            
        if cached:
            symbols = json.loads(cached)
            # Rebuild in-memory spot names from cache
            if not self._spot_names_cache:
                self._spot_names_cache = {s["symbol"] for s in symbols if s.get("source") == "Binance"}

            try:
                # Atomically check both sets exist (Fix #2.3 — single pipeline)
                pipe = self.redis_client.pipeline()
                pipe.exists("binance:futures_list")
                pipe.exists("binance:spot_list")
                exists_results = await pipe.execute()
                if not all(exists_results):
                    futures_names = [s["symbol"] for s in symbols if s.get("source") == "Binance Futures"]
                    spot_names_list = [s["symbol"] for s in symbols if s.get("source") == "Binance"]
                    rebuild_pipe = self.redis_client.pipeline()
                    if futures_names:
                        rebuild_pipe.delete("binance:futures_list")
                        rebuild_pipe.sadd("binance:futures_list", *futures_names)
                        rebuild_pipe.expire("binance:futures_list", self.cache_duration)
                    if spot_names_list:
                        rebuild_pipe.delete("binance:spot_list")
                        rebuild_pipe.sadd("binance:spot_list", *spot_names_list)
                        rebuild_pipe.expire("binance:spot_list", self.cache_duration)
                    await rebuild_pipe.execute()
                    logger.info("Rebuilt binance:futures_list and binance:spot_list from cache")
            except Exception as e:
                logger.debug(f"Redis pipeline failed (rebuild symbols): {e}")
            return symbols

        try:
            # 1. Fetch Spot (with retry — Fix #1.3)
            spot_data = await self._fetch_json(f"{self.BASE_URL}/exchangeInfo")

            symbols = []
            spot_symbol_names = set()

            for symbol_info in spot_data.get("symbols", []):
                if symbol_info.get("status") == "TRADING":
                    sym = symbol_info["symbol"]
                    spot_symbol_names.add(sym)
                    symbols.append({
                        "symbol": sym,
                        "baseAsset": symbol_info["baseAsset"],
                        "quoteAsset": symbol_info["quoteAsset"],
                        "source": "Binance",
                    })

            self._spot_names_cache = spot_symbol_names

            # 2. Fetch Futures (with retry)
            fut_data = await self._fetch_json(f"{settings.BINANCE_FUTURES_API_URL}/exchangeInfo")

            futures_symbol_names = []
            for symbol_info in fut_data.get("symbols", []):
                if symbol_info.get("status") == "TRADING":
                    sym = symbol_info["symbol"]
                    futures_symbol_names.append(sym)

                    # Add to search only if it's strictly a futures coin
                    if sym not in spot_symbol_names:
                        symbols.append({
                            "symbol": sym,
                            "baseAsset": symbol_info["baseAsset"],
                            "quoteAsset": symbol_info.get("quoteAsset", "USDT"),
                            "source": "Binance Futures",
                        })

            # Atomically update both spot and futures sets with TTL via pipeline
            if futures_symbol_names or spot_symbol_names:
                try:
                    pipe = self.redis_client.pipeline()
                    if futures_symbol_names:
                        pipe.delete("binance:futures_list")
                        pipe.sadd("binance:futures_list", *futures_symbol_names)
                        pipe.expire("binance:futures_list", self.cache_duration)
                    if spot_symbol_names:
                        pipe.delete("binance:spot_list")
                        pipe.sadd("binance:spot_list", *spot_symbol_names)
                        pipe.expire("binance:spot_list", self.cache_duration)
                    await pipe.execute()
                except Exception as e:
                    logger.debug(f"Redis pipeline failed (save symbol info): {e}")

            try:
                await self.redis_client.setex("binance:symbols", self.cache_duration, json.dumps(symbols))
            except Exception as e:
                logger.debug(f"Redis setex failed (binance:symbols): {e}")
                
            return symbols

        except Exception as e:
            logger.error(f"Error fetching exchange info from Binance: {e}")
            return []

    async def _is_futures_only(self, symbol: str) -> bool:
        """Check if a symbol is futures-only (not available on Spot)."""
        # Ensure cache is loaded first so we can check spot membership
        if not self._spot_names_cache:
            await self._fetch_exchange_info()
        # If it's on spot, it's definitely not futures-only
        if symbol in self._spot_names_cache:
            return False
        # Not on spot — check if it's on futures
        try:
            return await self.redis_client.sismember("binance:futures_list", symbol)
        except Exception:
            return True  # Fallback to true if Redis is down, to ensure futures URL is used if unknown

    async def search_symbols(self, query: str, limit: int = 50) -> List[Dict[str, str]]:
        """Search cached symbols by symbol name or base asset."""
        symbols = await self._fetch_exchange_info()

        if not query:
            return symbols[:limit]

        query = query.upper()
        results = []

        for s in symbols:
            symbol_name = s["symbol"].upper()
            base_asset = s["baseAsset"].upper()

            if query in symbol_name or query == base_asset:
                results.append(s)

            if len(results) >= limit:
                break

        return results

    async def get_popular_cryptos(self) -> List[Dict[str, str]]:
        try:
            cached = await self.redis_client.get("binance:popular")
        except Exception:
            cached = None
            
        if cached:
            return json.loads(cached)

        try:
            # Fix #1.3 — retry wrapper
            data = await self._fetch_json(f"{self.BASE_URL}/ticker/24hr")

            # Filter USDT pairs
            usdt_pairs = [
                d for d in data
                if d["symbol"].endswith("USDT")
                and "UPUSDT" not in d["symbol"]
                and "DOWNUSDT" not in d["symbol"]
            ]

            # Sort by quoteVolume descending
            usdt_pairs.sort(key=lambda x: float(x.get("quoteVolume", 0)), reverse=True)

            # Select top 25
            popular = []
            for t in usdt_pairs[:25]:
                sym = t["symbol"]
                popular.append({
                    "symbol": sym,
                    "baseAsset": sym.replace("USDT", ""),
                    "quoteAsset": "USDT",
                    "source": "Binance",
                })

            # Append Gold and Silver Futures
            popular.append({"symbol": "XAUUSDT", "baseAsset": "XAU", "quoteAsset": "USDT", "source": "Binance Futures"})
            popular.append({"symbol": "XAGUSDT", "baseAsset": "XAG", "quoteAsset": "USDT", "source": "Binance Futures"})

            try:
                await self.redis_client.setex("binance:popular", self.cache_duration, json.dumps(popular))
            except Exception:
                pass
                
            return popular

        except Exception as e:
            logger.error(f"Error fetching popular cryptos: {e}")
            return []

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 100) -> List[Dict[str, Any]]:
        """Fetch K-line data from Binance with Redis caching and pagination for high limits."""
        symbol = symbol.upper()

        # ── Check Redis cache first ──
        cache_key = f"klines:binance:{symbol}:{interval}:{limit}"
        try:
            cached = await self.redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

        # Efficiently check if this is a futures-only symbol using cached set
        if await self._is_futures_only(symbol):
            url = f"{settings.BINANCE_FUTURES_API_URL}/klines"
        else:
            url = f"{self.BASE_URL}/klines"

        all_raw_data = []
        remaining = limit
        end_time = None

        try:
            # ── Auto-paginate to bypass Binance's 1000-candle hard limit ──
            while remaining > 0:
                batch_limit = min(remaining, 1000)
                params = {
                    "symbol": symbol,
                    "interval": interval,
                    "limit": batch_limit,
                }
                if end_time:
                    params["endTime"] = end_time

                # Fix #1.3 — retry wrapper inside the loop
                data = await self._fetch_json(url, params)
                
                if not data or not isinstance(data, list):
                    break

                # Binance returns [oldest ... newest]. Prepend to our list.
                all_raw_data = data + all_raw_data
                remaining -= len(data)

                if len(data) < batch_limit:
                    break # Reached the very beginning of the asset's history

                # The first item is the oldest candle: data[0][0] is its open time
                # Wait, data[0][0] is open time. We want the next chunk to end JUST BEFORE this candle.
                end_time = data[0][0] - 1

            if not all_raw_data:
                return []

            formatted_data = []
            for candle in all_raw_data:
                formatted_data.append({
                    "time": int(candle[0] / 1000),
                    "open": float(candle[1]),
                    "high": float(candle[2]),
                    "low": float(candle[3]),
                    "close": float(candle[4]),
                    "volume": float(candle[5]),
                })

            # ── Cache with interval-aware TTL (Fix #2.2) ──
            ttl_map = {"1m": 5, "3m": 10, "5m": 15, "15m": 30, "30m": 60, "1h": 60, "4h": 120}
            ttl = ttl_map.get(interval, 300)  # default 5 min for daily+
            try:
                await self.redis_client.setex(cache_key, ttl, json.dumps(formatted_data))
            except Exception:
                pass

            return formatted_data

        except Exception as e:
            logger.error(f"Error fetching klines from Binance for {symbol}: {e}")
            return []

    async def get_ticker_24h(self, symbols: List[str], *, use_cache: bool = True) -> Dict[str, Dict[str, Any]]:
        """Fetch 24hr ticker price change statistics for multiple symbols."""
        if not symbols:
            return {}

        # Build spot name set once for efficient lookup (Fix #4.1)
        if not self._spot_names_cache:
            await self._fetch_exchange_info()

        result: Dict[str, Dict[str, Any]] = {}
        missing_spot: List[str] = []
        missing_futures: List[str] = []

        def route_symbol(s_upper: str) -> None:
            if s_upper in self._spot_names_cache:
                missing_spot.append(s_upper)
            else:
                missing_futures.append(s_upper)

        if use_cache:
            # Try Redis first (avoids 0.00 until WS updates); resync paths pass use_cache=False.
            for s in symbols:
                s_upper = s.upper()
                try:
                    cached = await self.redis_client.hget("binance:tickers", s_upper)
                except Exception as e:
                    logger.debug(f"Redis hget failed (binance:tickers): {e}")
                    cached = None

                if cached:
                    result[s_upper] = json.loads(cached)
                else:
                    if not self._spot_names_cache:
                        await self._fetch_exchange_info()
                    route_symbol(s_upper)
        else:
            for s in symbols:
                s_upper = s.upper()
                route_symbol(s_upper)

        # Fetch missing spot symbols
        if missing_spot:
            try:
                spot_str = json.dumps(missing_spot, separators=(",", ":"))
                url = f"{self.BASE_URL}/ticker/24hr"
                data = await self._fetch_json(url, {"symbols": spot_str})
                if isinstance(data, dict):
                    data = [data]

                pipe = self.redis_client.pipeline()
                for ticker in data:
                    sym = ticker["symbol"].upper()
                    ticker_data = {
                        "lastPrice": float(ticker["lastPrice"]),
                        "priceChange": float(ticker["priceChange"]),
                        "priceChangePercent": float(ticker["priceChangePercent"]),
                    }
                    result[sym] = ticker_data
                    pipe.hset("binance:tickers", sym, json.dumps(ticker_data))
                await pipe.execute()
            except Exception as e:
                logger.error(f"Error fetching spot 24hr ticker: {e}")

        # Fetch missing futures symbols
        if missing_futures:
            try:
                fut_str = json.dumps(missing_futures, separators=(",", ":"))
                url = f"{settings.BINANCE_FUTURES_API_URL}/ticker/24hr"
                data = await self._fetch_json(url, {"symbols": fut_str})
                if isinstance(data, dict):
                    data = [data]

                pipe = self.redis_client.pipeline()
                for ticker in data:
                    sym = ticker["symbol"].upper()
                    ticker_data = {
                        "lastPrice": float(ticker["lastPrice"]),
                        "priceChange": float(ticker["priceChange"]),
                        "priceChangePercent": float(ticker["priceChangePercent"]),
                    }
                    result[sym] = ticker_data
                    pipe.hset("binance:tickers", sym, json.dumps(ticker_data))
                await pipe.execute()
            except Exception as e:
                logger.error(f"Error fetching futures 24hr ticker: {e}")

        # If we skipped cache, fill any gaps from Redis so a partial API failure does not wipe UI to 0.
        if not use_cache:
            for s in symbols:
                s_upper = s.upper()
                if s_upper in result:
                    continue
                try:
                    cached = await self.redis_client.hget("binance:tickers", s_upper)
                    if cached:
                        result[s_upper] = json.loads(cached)
                except Exception as e:
                    logger.debug(f"Redis fallback after force refresh failed for {s_upper}: {e}")

        return result


binance_service = BinanceService()
