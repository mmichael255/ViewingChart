import time
import httpx
import json
import asyncio
import logging
import redis.asyncio as redis
import yfinance as yf
from typing import List, Dict, Any, Tuple
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import settings, get_redis

logger = logging.getLogger(__name__)


class StockService:
    def __init__(self):
        self.alphavantage_api_key = settings.ALPHA_VANTAGE_API_KEY
        self.alphavantage_base_url = settings.ALPHA_VANTAGE_BASE_URL
        self.yahoo_search_url = settings.YAHOO_SEARCH_URL
        self.yahoo_trending_url = settings.YAHOO_TRENDING_URL

        if not self.alphavantage_api_key or self.alphavantage_api_key == "demo":
            logger.warning("ALPHAVANTAGE_API_KEY not properly configured in .env file")

        # Shared Redis pool (Fix #2.1)
        self.redis_client = get_redis()
        self.cache_duration = 300  # 5 minutes (Fix #2.4 — raised from 60s)
        self.search_cache_duration = 3600
        # Shared HTTP client — reuse TCP connections (Fix #1.1 — used everywhere now)
        self.http_client = httpx.AsyncClient(timeout=15.0)

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
    async def _fetch_json(self, url: str, params: dict | None = None, headers: dict | None = None) -> Any:
        """HTTP GET with automatic retry + exponential backoff — uses shared client (Fix #1.1)."""
        response = await self.http_client.get(url, params=params or {}, headers=headers or {})
        response.raise_for_status()
        return response.json()

    def _is_alphavantage_symbol(self, symbol: str) -> bool:
        """
        Determine if a symbol should be routed to Alpha Vantage (FX/Metals)
        instead of yfinance.
        """
        if symbol.endswith("=X"):
            return True
        if "/" in symbol:
            return True
        if symbol.upper().startswith(("XAU", "XAG", "XPT", "XPD")):
            return True
        return False

    def _format_alphavantage_symbol(self, symbol: str) -> Tuple[str, str, str]:
        """
        Returns (function_type, from_symbol, to_symbol)
        """
        sym = symbol.upper().replace("=X", "")

        if "/" in sym:
            parts = sym.split("/")
            return "FX", parts[0], parts[1]

        if sym == "XAUUSD" or sym == "XAGUSD":
            return "FX", sym[:3], sym[3:]

        # Default fallback, assume it's like EURUSD
        if len(sym) == 6:
             return "FX", sym[:3], sym[3:]

        return "UNKNOWN", sym, ""

    def _map_yf_interval(self, interval: str) -> str:
        """Map frontend interval to yfinance interval."""
        mapping = {
            "1m": "1m",
            "3m": "2m",  # yf doesn't have 3m, fallback to 2m
            "5m": "5m",
            "15m": "15m",
            "30m": "30m",
            "1h": "60m",
            "4h": "60m",  # fetch 60m, then aggregate (Fix #4.3)
            "1d": "1d",
            "1w": "1wk",
            "1M": "1mo"
        }
        return mapping.get(interval, "1d")

    def _map_av_interval(self, interval: str) -> str:
        """Map frontend interval to Alpha Vantage interval."""
        mapping = {
            "1m": "1min",
            "5m": "5min",
            "15m": "15min",
            "30m": "30min",
            "1h": "60min",
            "4h": "60min",  # AV max intraday is 60min, aggregated after fetch
            "1d": "DAILY",
            "1w": "WEEKLY",
            "1M": "MONTHLY"
        }
        return mapping.get(interval, "DAILY")

    @staticmethod
    def _aggregate_candles(candles: List[Dict[str, Any]], factor: int) -> List[Dict[str, Any]]:
        """
        Aggregate N consecutive candles into 1. Used for 4h from 1h data (Fix #4.3).
        E.g. factor=4 groups every 4 candles into one.
        """
        if factor <= 1 or not candles:
            return candles

        aggregated = []
        for i in range(0, len(candles), factor):
            group = candles[i:i + factor]
            if not group:
                continue
            aggregated.append({
                "time": group[0]["time"],
                "open": group[0]["open"],
                "high": max(c["high"] for c in group),
                "low": min(c["low"] for c in group),
                "close": group[-1]["close"],
                "volume": sum(c["volume"] for c in group),
            })
        return aggregated

    async def _get_yf_klines(self, symbol: str, interval: str, limit: int = 1000) -> List[Dict[str, Any]]:
        yf_interval = self._map_yf_interval(interval)
        needs_aggregation = interval == "4h"

        # yfinance has strict limits on historical data for intraday intervals
        period = "max"
        if yf_interval == "1m":
            period = "7d"
        elif yf_interval in ["2m", "5m", "15m", "30m", "60m", "90m", "1h"]:
            period = "60d"

        # Fetch data asynchronously using thread pool since yfinance is blocking
        def fetch_yf():
            ticker = yf.Ticker(symbol)
            return ticker.history(period=period, interval=yf_interval)

        df = await asyncio.to_thread(fetch_yf)

        if df.empty:
            return []

        # Format for frontend
        formatted_data = []
        for index, row in df.iterrows():
            formatted_data.append({
                "time": int(index.timestamp()),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Volume"])
            })

        # Aggregate 4 × 1h → 4h if needed (Fix #4.3)
        if needs_aggregation:
            formatted_data = self._aggregate_candles(formatted_data, 4)

        # Return only the requested limit
        return formatted_data[-limit:]

    async def _get_av_klines(self, symbol: str, interval: str, limit: int = 1000) -> List[Dict[str, Any]]:
        if not self.alphavantage_api_key:
            logger.warning("Alpha Vantage API key missing")
            return []

        av_interval = self._map_av_interval(interval)
        needs_aggregation = interval == "4h"
        ftype, from_sym, to_sym = self._format_alphavantage_symbol(symbol)

        params = {"apikey": self.alphavantage_api_key}

        # API requires different functions based on interval
        if av_interval in ["DAILY", "WEEKLY", "MONTHLY"]:
             params["function"] = f"FX_{av_interval}"
             params["from_symbol"] = from_sym
             params["to_symbol"] = to_sym
             data_key = f"Time Series FX ({av_interval.capitalize()})"
        else:
             params["function"] = "FX_INTRADAY"
             params["from_symbol"] = from_sym
             params["to_symbol"] = to_sym
             params["interval"] = av_interval
             params["outputsize"] = "full"
             data_key = f"Time Series FX ({av_interval})"

        try:
            # Fix #1.1 — use shared client; Fix #1.3 — retry wrapper
            data = await self._fetch_json(self.alphavantage_base_url, params=params)

            if "Note" in data:
                logger.warning(f"Alpha Vantage limit reached: {data['Note']}")
                return []

            if "Error Message" in data:
                 logger.error(f"Alpha Vantage error: {data['Error Message']}")
                 return []

            series_data = data.get(data_key, {})

            formatted_data = []

            from datetime import datetime
            import pytz

            for timestamp_str, values in series_data.items():
                try:
                    if len(timestamp_str) > 10:
                        dt = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")
                    else:
                        dt = datetime.strptime(timestamp_str, "%Y-%m-%d")

                    tz = pytz.timezone('US/Eastern')
                    dt = tz.localize(dt)

                    formatted_data.append({
                        "time": int(dt.timestamp()),
                        "open": float(values["1. open"]),
                        "high": float(values["2. high"]),
                        "low": float(values["3. low"]),
                        "close": float(values["4. close"]),
                        "volume": 0  # FX doesn't generally have volume in AV free tier
                    })
                except Exception as e:
                    logger.warning(f"Error parsing date {timestamp_str}: {e}")

            # AV returns data newest-first, we need oldest-first
            formatted_data.reverse()

            # Aggregate 4 × 1h → 4h if needed (Fix #4.3)
            if needs_aggregation:
                formatted_data = self._aggregate_candles(formatted_data, 4)

            return formatted_data[-limit:]

        except Exception as e:
            logger.error(f"Error fetching Alpha Vantage data: {e}")
            return []

    async def get_klines(self, symbol: str, interval: str = "4h", limit: int = 1000) -> List[Dict[str, Any]]:
        """
        Fetch historical kline data with Redis caching (Fix #2.2).
        Routes to yfinance or Alpha Vantage.
        """
        # ── Check Redis cache first (Fix #2.2) ──
        cache_key = f"klines:stock:{symbol}:{interval}:{limit}"
        cached = await self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

        if self._is_alphavantage_symbol(symbol):
             data = await self._get_av_klines(symbol, interval, limit)
        else:
             data = await self._get_yf_klines(symbol, interval, limit)

        # ── Cache with interval-aware TTL (Fix #2.2) ──
        if data:
            ttl_map = {"1m": 5, "3m": 10, "5m": 15, "15m": 30, "30m": 60, "1h": 60, "4h": 120}
            ttl = ttl_map.get(interval, 300)
            await self.redis_client.setex(cache_key, ttl, json.dumps(data))

        return data

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Fetch real-time quote for a single asset.
        """
        if self._is_alphavantage_symbol(symbol):
            # Alpha Vantage Realtime FX
            ftype, from_sym, to_sym = self._format_alphavantage_symbol(symbol)
            params = {
                "function": "CURRENCY_EXCHANGE_RATE",
                "from_currency": from_sym,
                "to_currency": to_sym,
                "apikey": self.alphavantage_api_key
            }
            try:
                # Fix #1.1 — use shared client; Fix #1.3 — retry wrapper
                res = await self._fetch_json(self.alphavantage_base_url, params=params)
                if "Realtime Currency Exchange Rate" in res:
                    rate = float(res["Realtime Currency Exchange Rate"]["5. Exchange Rate"])
                    return {
                        "lastPrice": rate,
                        "priceChange": 0,
                        "priceChangePercent": 0
                    }
            except Exception as e:
                 logger.error(f"AV Quote Error: {symbol} - {e}")
            return {}
        else:
            # yfinance quote
            def fetch_yfinance_quote():
                try:
                    ticker = yf.Ticker(symbol)
                    last_price = None
                    prev_close = None

                    try:
                        fi = ticker.fast_info
                        if fi is not None:
                            lp = getattr(fi, 'last_price', None)
                            pc = getattr(fi, 'previous_close', None)
                            if lp is not None and pc is not None:
                                last_price = float(lp)
                                prev_close = float(pc)
                    except Exception:
                        pass

                    # Fallback to recent history if fast_info failed
                    if last_price is None or prev_close is None:
                        hist = ticker.history(period="5d")
                        if hist.empty:
                            return {}
                        last_price = float(hist['Close'].iloc[-1])
                        prev_close = float(hist['Close'].iloc[-2]) if len(hist) > 1 else last_price

                    change = last_price - prev_close
                    change_pct = (change / prev_close) * 100 if prev_close else 0

                    return {
                        "lastPrice": last_price,
                        "priceChange": change,
                        "priceChangePercent": change_pct
                    }
                except Exception as e:
                    logger.error(f"yfinance Quote Error for {symbol}: {e}")
                    return {}

            return await asyncio.to_thread(fetch_yfinance_quote)

    async def get_quotes(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Fetch quotes for multiple stocks with basic caching.
        """
        results = {}

        async def fetch_and_cache(sym: str):
            # Check cache
            cached = await self.redis_client.get(f'stock_quote:{sym}')
            if cached:
                results[sym] = json.loads(cached)
                return

            # Fetch fresh
            quote = await self.get_quote(sym)
            if quote:
                await self.redis_client.setex(f'stock_quote:{sym}', self.cache_duration, json.dumps(quote))
                results[sym] = quote

        # Wait for all quote fetches to resolve via asyncio gather
        await asyncio.gather(*(fetch_and_cache(s) for s in symbols))

        return results

    async def search_symbols(self, query: str) -> List[Dict[str, str]]:
        """
        Search for symbols using Yahoo Finance API with caching.
        """
        results = []
        if not query:
            return results

        # Check Cache
        query_lower = query.lower()
        cached = await self.redis_client.get(f'stock_search:{query_lower}')
        if cached:
            return json.loads(cached)

        try:
            headers = {"User-Agent": "Mozilla/5.0"}
            params = {"q": query, "quotesCount": 50, "newsCount": 0}

            # Fix #1.1 — use shared client; Fix #1.3 — retry wrapper
            data = await self._fetch_json(self.yahoo_search_url, params=params, headers=headers)

            quotes = data.get("quotes", [])
            for q in quotes:
                symbol = q.get("symbol", "")
                name = q.get("shortname") or q.get("longname") or symbol
                quote_type = q.get("quoteType", "EQUITY")

                # Determine source
                is_av = self._is_alphavantage_symbol(symbol)

                results.append({
                    "symbol": symbol,
                    "name": name,
                    "type": quote_type,
                    "source": "Alpha Vantage" if is_av else "Yahoo Finance"
                })

            # Update cache
            await self.redis_client.setex(f'stock_search:{query_lower}', self.search_cache_duration, json.dumps(results))

        except Exception as e:
            logger.error(f"Error searching via Yahoo Finance: {e}")

        return results

    async def get_popular_stocks(self) -> List[Dict[str, str]]:
        cached = await self.redis_client.get('stock_popular')
        if cached:
            return json.loads(cached)

        try:
            headers = {"User-Agent": "Mozilla/5.0"}

            # Fix #1.1 — use shared client; Fix #1.3 — retry wrapper
            data = await self._fetch_json(self.yahoo_trending_url, headers=headers)

            quotes = data["finance"]["result"][0]["quotes"]

            syms = [q["symbol"] for q in quotes if "=" not in q["symbol"] and "-" not in q["symbol"]]
            syms = syms[:20]

            def fetch_tickers_meta():
                return yf.Tickers(" ".join(syms))

            tickers_obj = await asyncio.to_thread(fetch_tickers_meta)

            def extract_name(sym):
                try:
                    return tickers_obj.tickers[sym].info.get("shortName", sym)
                except Exception:
                    return sym

            # Fix #4.2 — Parallelize name extraction with asyncio.gather
            async def get_name(sym):
                return await asyncio.to_thread(lambda s=sym: extract_name(s))

            names = await asyncio.gather(*[get_name(s) for s in syms])

            popular = []
            for sym, short_name in zip(syms, names):
                popular.append({
                    "symbol": sym,
                    "name": short_name,
                    "type": "EQUITY",
                    "source": "Yahoo Finance"
                })

            # Add some popular currencies
            popular.extend([
                { "symbol": "EURUSD=X", "name": "EUR/USD", "type": "CURRENCY", "source": "Alpha Vantage" },
                { "symbol": "GBPUSD=X", "name": "GBP/USD", "type": "CURRENCY", "source": "Alpha Vantage" },
                { "symbol": "USDJPY=X", "name": "USD/JPY", "type": "CURRENCY", "source": "Alpha Vantage" }
            ])

            await self.redis_client.setex('stock_popular', self.search_cache_duration, json.dumps(popular))
            return popular
        except Exception as e:
            logger.error(f"Error fetching popular stocks: {e}")
            return []


stock_service = StockService()
