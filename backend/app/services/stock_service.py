import httpx
import json
import asyncio
import logging
import os
from datetime import datetime, time as dt_time
from zoneinfo import ZoneInfo
import redis.asyncio as redis
import yfinance as yf
from typing import List, Dict, Any, Tuple, Literal
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
        self.stock_quote_ttl_active = settings.STOCK_QUOTE_TTL_ACTIVE
        self.stock_quote_ttl_closed = settings.STOCK_QUOTE_TTL_CLOSED
        self.stock_quote_failure_ttl = settings.STOCK_QUOTE_FAILURE_TTL
        self.stock_regular_only_mode = settings.STOCK_REGULAR_ONLY_MODE
        self.search_cache_duration = 3600
        # Shared HTTP client — reuse TCP connections (Fix #1.1 — used everywhere now)
        self.http_client = httpx.AsyncClient(timeout=15.0)
        self._stats: Dict[str, Any] = {
            "cache_hits": 0,
            "cache_misses": 0,
            "upstream_success": 0,
            "upstream_failure": 0,
            "upstream_failure_timeout": 0,
            "upstream_failure_rate_limit": 0,
            "upstream_failure_empty_payload": 0,
            "upstream_failure_missing_fields": 0,
            "upstream_latency_ms_total": 0.0,
            "upstream_latency_samples": 0,
            "upstream_latency_p95_ms": 0.0,
            "pre_market_coverage_total": 0,
            "pre_market_coverage_available": 0,
            "post_market_coverage_total": 0,
            "post_market_coverage_available": 0,
            "fallback_cache_used": 0,
            "fallback_lastgood_used": 0,
            "regular_only_mode_hits": 0,
        }
        self._latency_samples: list[float] = []

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

    def _stock_quote_ttl_seconds(self) -> int:
        """
        Dynamic TTL for stock quotes:
        - Weekday US windows (pre / overnight / regular / post): shorter TTL.
        - Weekend: longer TTL.
        """
        now_et = datetime.now(ZoneInfo("America/New_York"))
        if now_et.weekday() >= 5:  # Sat/Sun
            return self.stock_quote_ttl_closed
        return self.stock_quote_ttl_active

    @staticmethod
    def _current_session_et() -> Literal["pre", "regular", "post", "overnight", "closed"]:
        now_et = datetime.now(ZoneInfo("America/New_York"))
        if now_et.weekday() >= 5:
            return "closed"
        t = now_et.time()
        if t >= dt_time(20, 0) or t < dt_time(4, 0):
            return "overnight"
        if dt_time(4, 0) <= t < dt_time(9, 30):
            return "pre"
        if dt_time(9, 30) <= t < dt_time(16, 0):
            return "regular"
        if dt_time(16, 0) <= t < dt_time(20, 0):
            return "post"
        return "closed"

    def _record_stat(self, key: str, delta: int | float = 1) -> None:
        self._stats[key] = self._stats.get(key, 0) + delta

    def _regular_only_mode_enabled(self) -> bool:
        # Hot-read env to allow quick operational rollback without restart.
        raw = os.getenv("STOCK_REGULAR_ONLY_MODE")
        if raw is None:
            return self.stock_regular_only_mode
        return raw.lower() in {"1", "true", "yes", "on"}

    def _record_latency(self, ms: float) -> None:
        self._record_stat("upstream_latency_ms_total", ms)
        self._record_stat("upstream_latency_samples", 1)
        self._latency_samples.append(ms)
        if len(self._latency_samples) > 200:
            self._latency_samples.pop(0)
        s = sorted(self._latency_samples)
        idx = max(0, min(len(s) - 1, int(len(s) * 0.95) - 1))
        self._stats["upstream_latency_p95_ms"] = s[idx] if s else 0.0

    @staticmethod
    def _safe_float(v: Any) -> float | None:
        try:
            if v is None:
                return None
            return float(v)
        except Exception:
            return None

    def _quote_from_prices(
        self,
        *,
        session: Literal["pre", "regular", "post", "overnight", "closed"],
        regular_price: float,
        prev_close: float,
        pre_market_price: float | None,
        post_market_price: float | None,
        overnight_market_price: float | None,
        as_of: int,
    ) -> Dict[str, Any]:
        # NOTE — current semantics of STOCK_REGULAR_ONLY_MODE:
        #   * It ONLY decides whether `lastPrice` follows pre/post/overnight during
        #     extended hours, or stays pinned to the regular-session close.
        #   * It does NOT strip `preMarketPrice` / `postMarketPrice` /
        #     `overnightMarketPrice` from the payload — those are still returned
        #     so the frontend can surface them next to the chart and watchlist.
        # If a future need arises to actually hide extended fields, add a
        # separate flag (e.g. STOCK_HIDE_EXTENDED_FIELDS) rather than
        # overloading this one.
        current_price = regular_price
        regular_only = self._regular_only_mode_enabled()
        if regular_only:
            self._record_stat("regular_only_mode_hits")
        if not regular_only:
            if session == "pre" and pre_market_price is not None:
                current_price = pre_market_price
            elif session == "post" and post_market_price is not None:
                current_price = post_market_price
            elif session == "overnight" and overnight_market_price is not None:
                current_price = overnight_market_price

        baseline = prev_close
        change = current_price - baseline
        change_pct = (change / baseline) * 100 if baseline else 0

        if pre_market_price is not None:
            self._record_stat("pre_market_coverage_available")
        self._record_stat("pre_market_coverage_total")
        if post_market_price is not None:
            self._record_stat("post_market_coverage_available")
        self._record_stat("post_market_coverage_total")

        quote = {
            "lastPrice": current_price,
            "priceChange": change,
            "priceChangePercent": change_pct,
            "session": session,
            "preMarketPrice": pre_market_price,
            "postMarketPrice": post_market_price,
            "overnightMarketPrice": overnight_market_price,
            "previousClose": prev_close,
            "baselinePrice": baseline,
            "asOf": as_of,
        }
        return self._normalize_quote(quote)

    @staticmethod
    def _normalize_quote(raw: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "lastPrice": float(raw.get("lastPrice", 0)),
            "priceChange": float(raw.get("priceChange", 0)),
            "priceChangePercent": float(raw.get("priceChangePercent", 0)),
            "session": raw.get("session", "regular"),
            "preMarketPrice": raw.get("preMarketPrice"),
            "postMarketPrice": raw.get("postMarketPrice"),
            "overnightMarketPrice": raw.get("overnightMarketPrice"),
            "previousClose": raw.get("previousClose"),
            "baselinePrice": raw.get("baselinePrice"),
            "asOf": raw.get("asOf"),
            "isStale": bool(raw.get("isStale", False)),
        }

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

    @staticmethod
    def _filter_regular_session_intraday(
        candles: List[Dict[str, Any]],
        tz: ZoneInfo,
    ) -> List[Dict[str, Any]]:
        """
        Keep only US regular-session intraday bars (9:30–16:00 ET) and drop obvious
        non-trading placeholders (e.g. volume=0).
        """
        out: List[Dict[str, Any]] = []
        for c in candles:
            try:
                ts = int(c["time"])
                vol = float(c.get("volume") or 0)
            except Exception:
                continue
            if vol <= 0:
                continue
            dt_et = datetime.fromtimestamp(ts, tz=tz)
            if dt_et.weekday() >= 5:
                continue
            t = dt_et.time()
            if dt_time(9, 30) <= t < dt_time(16, 0):
                out.append(c)
        return out

    @staticmethod
    def _aggregate_candles_by_day(
        candles: List[Dict[str, Any]],
        factor: int,
        tz: ZoneInfo,
    ) -> List[Dict[str, Any]]:
        """
        Aggregate by fixed-size groups but never across ET day boundaries.
        This avoids creating impossible 4h bars when there are overnight gaps.
        """
        if factor <= 1 or not candles:
            return candles

        aggregated: List[Dict[str, Any]] = []
        i = 0
        while i < len(candles):
            base_day = datetime.fromtimestamp(int(candles[i]["time"]), tz=tz).date()
            group: List[Dict[str, Any]] = []
            while i < len(candles) and len(group) < factor:
                day = datetime.fromtimestamp(int(candles[i]["time"]), tz=tz).date()
                if day != base_day:
                    break
                group.append(candles[i])
                i += 1

            if group:
                aggregated.append(
                    {
                        "time": group[0]["time"],
                        "open": group[0]["open"],
                        "high": max(c["high"] for c in group),
                        "low": min(c["low"] for c in group),
                        "close": group[-1]["close"],
                        "volume": sum(c["volume"] for c in group),
                    }
                )

            # If we stopped because the day changed, the next loop iteration will
            # start a new group on the new day.
            while i < len(candles):
                next_day = datetime.fromtimestamp(int(candles[i]["time"]), tz=tz).date()
                if next_day == base_day:
                    break
                # Skip any unexpected out-of-order rows that still belong to base_day
                break

        return aggregated

    async def _get_yf_klines(self, symbol: str, interval: str, limit: int = 1000, include_extended: bool = False) -> List[Dict[str, Any]]:
        yf_interval = self._map_yf_interval(interval)
        needs_aggregation = interval == "4h"
        tz_et = ZoneInfo("America/New_York")

        # yfinance has strict limits on historical data for intraday intervals
        period = "max"
        if yf_interval == "1m":
            period = "7d"
        elif yf_interval in ["2m", "5m", "15m", "30m", "60m", "90m", "1h"]:
            period = "60d"

        # Fetch data asynchronously using thread pool since yfinance is blocking
        def fetch_yf():
            ticker = yf.Ticker(symbol)
            # prepost only affects intraday bars.
            return ticker.history(period=period, interval=yf_interval, prepost=include_extended)

        try:
            df = await asyncio.to_thread(fetch_yf)
        except Exception as e:
            logger.error(f"Error fetching yfinance klines for {symbol}: {e}")
            return []

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

        # If extended hours are disabled, drop pre/post/overnight intraday bars.
        # Apply BEFORE aggregation so 4h bars don't cross non-trading gaps.
        if not include_extended and interval in {"1m", "3m", "5m", "15m", "30m", "1h", "4h"}:
            formatted_data = self._filter_regular_session_intraday(formatted_data, tz_et)

        # Aggregate 4 × 1h → 4h if needed (Fix #4.3)
        if needs_aggregation:
            formatted_data = self._aggregate_candles_by_day(formatted_data, 4, tz_et)

        # Return only the requested limit
        return formatted_data[-limit:]

    async def _get_av_klines(self, symbol: str, interval: str, limit: int = 1000, include_extended: bool = False) -> List[Dict[str, Any]]:
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

    async def get_klines(
        self,
        symbol: str,
        interval: str = "4h",
        limit: int = 1000,
        include_extended: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Fetch historical kline data with Redis caching (Fix #2.2).
        Routes to yfinance or Alpha Vantage.
        """
        # ── Check Redis cache first (Fix #2.2) ──
        cache_key = f"klines:stock:{symbol}:{interval}:{limit}:ext:{1 if include_extended else 0}"
        try:
            cached = await self.redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.debug(f"Redis get failed ({cache_key}): {e}")

        if self._is_alphavantage_symbol(symbol):
             data = await self._get_av_klines(symbol, interval, limit, include_extended=include_extended)
        else:
             data = await self._get_yf_klines(symbol, interval, limit, include_extended=include_extended)

        # ── Cache with interval-aware TTL (Fix #2.2) ──
        if data:
            ttl_map = {"1m": 5, "3m": 10, "5m": 15, "15m": 30, "30m": 60, "1h": 60, "4h": 120}
            ttl = ttl_map.get(interval, 300)
            try:
                await self.redis_client.setex(cache_key, ttl, json.dumps(data))
            except Exception as e:
                logger.debug(f"Redis setex failed ({cache_key}): {e}")

        return data

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Fetch real-time quote for a single asset.
        """
        t0 = datetime.now().timestamp()
        session = self._current_session_et()
        as_of = int(datetime.now(ZoneInfo("America/New_York")).timestamp())
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
                    return self._normalize_quote({
                        "lastPrice": rate,
                        "priceChange": 0,
                        "priceChangePercent": 0,
                        "session": session,
                        "preMarketPrice": None,
                        "postMarketPrice": None,
                        "overnightMarketPrice": None,
                        "previousClose": rate,
                        "baselinePrice": rate,
                        "asOf": as_of,
                    })
            except Exception as e:
                 logger.error(f"AV Quote Error: {symbol} - {e}")
            self._record_stat("upstream_failure")
            return {}
        else:
            # yfinance quote
            def fetch_yfinance_quote():
                try:
                    ticker = yf.Ticker(symbol)
                    regular_price = None
                    prev_close = None
                    pre_market_price = None
                    post_market_price = None
                    overnight_market_price = None

                    _info_cache: list[Dict[str, Any] | None] = [None]

                    def load_info() -> Dict[str, Any]:
                        if _info_cache[0] is None:
                            try:
                                _info_cache[0] = dict(ticker.info or {})
                            except Exception:
                                _info_cache[0] = {}
                        return _info_cache[0]

                    try:
                        fi = ticker.fast_info
                        if fi is not None:
                            lp = getattr(fi, 'last_price', None)
                            pc = getattr(fi, 'previous_close', None)
                            pre = getattr(fi, 'pre_market_price', None)
                            post = getattr(fi, 'post_market_price', None)
                            ovn = getattr(fi, 'overnight_price', None)
                            regular_price = self._safe_float(lp)
                            prev_close = self._safe_float(pc)
                            pre_market_price = self._safe_float(pre)
                            post_market_price = self._safe_float(post)
                            overnight_market_price = self._safe_float(ovn)
                    except Exception:
                        pass

                    if pre_market_price is None or post_market_price is None:
                        try:
                            info = load_info()
                            if regular_price is None:
                                regular_price = (
                                    self._safe_float(info.get("regularMarketPrice"))
                                    or self._safe_float(info.get("currentPrice"))
                                )
                            if prev_close is None:
                                prev_close = (
                                    self._safe_float(info.get("regularMarketPreviousClose"))
                                    or self._safe_float(info.get("previousClose"))
                                )
                            if pre_market_price is None:
                                pre_market_price = self._safe_float(info.get("preMarketPrice"))
                            if post_market_price is None:
                                post_market_price = self._safe_float(info.get("postMarketPrice"))
                        except Exception:
                            pass

                    if overnight_market_price is None:
                        info = load_info()
                        for key in (
                            "overnightMarketPrice",
                            "overnightPrice",
                            "overnight_market_price",
                        ):
                            overnight_market_price = self._safe_float(info.get(key))
                            if overnight_market_price is not None:
                                break

                    # Fallback to recent history if fast_info failed
                    if regular_price is None or prev_close is None:
                        hist = ticker.history(period="5d")
                        if hist.empty:
                            self._record_stat("upstream_failure_empty_payload")
                            return {}
                        regular_price = float(hist['Close'].iloc[-1])
                        prev_close = float(hist['Close'].iloc[-2]) if len(hist) > 1 else regular_price

                    if regular_price is None or prev_close is None:
                        self._record_stat("upstream_failure_missing_fields")
                        return {}

                    # Yahoo / yfinance usually omit overnightMarketPrice. During the overnight
                    # window, prefer fast_info.last_price (regular_price); if it is still pinned
                    # at previous close but postMarketPrice has moved, use post (some feeds only
                    # refresh the post bucket for O/N).
                    if session == "overnight" and overnight_market_price is None:
                        if regular_price is not None:
                            overnight_market_price = regular_price
                        pc = prev_close
                        if (
                            overnight_market_price is not None
                            and pc is not None
                            and post_market_price is not None
                            and abs(overnight_market_price - pc) <= 1e-4 * max(abs(pc), 1e-9)
                            and abs(post_market_price - pc) > 1e-4 * max(abs(pc), 1e-9)
                        ):
                            overnight_market_price = post_market_price

                    return self._quote_from_prices(
                        session=session,
                        regular_price=regular_price,
                        prev_close=prev_close,
                        pre_market_price=pre_market_price,
                        post_market_price=post_market_price,
                        overnight_market_price=overnight_market_price,
                        as_of=as_of,
                    )
                except httpx.ReadTimeout:
                    self._record_stat("upstream_failure_timeout")
                    logger.error(f"yfinance Quote timeout for {symbol}")
                    return {}
                except Exception as e:
                    msg = str(e).lower()
                    if "rate limit" in msg or "429" in msg:
                        self._record_stat("upstream_failure_rate_limit")
                    logger.error(f"yfinance Quote Error for {symbol}: {e}")
                    return {}

            quote = await asyncio.to_thread(fetch_yfinance_quote)
            latency_ms = (datetime.now().timestamp() - t0) * 1000
            self._record_latency(latency_ms)
            if quote:
                self._record_stat("upstream_success")
            else:
                self._record_stat("upstream_failure")
            return quote

    async def get_quotes(self, symbols: List[str], use_cache: bool = True) -> Dict[str, Dict[str, Any]]:
        """
        Fetch quotes for multiple stocks with basic caching.
        """
        results = {}

        async def fetch_and_cache(sym: str):
            quote_key = f"stock_quote:{sym}"
            fail_key = f"stock_quote_fail:{sym}"
            last_good_key = f"stock_quote_lastgood:{sym}"
            if use_cache:
                try:
                    cached = await self.redis_client.get(quote_key)
                    if cached:
                        self._record_stat("cache_hits")
                        results[sym] = self._normalize_quote(json.loads(cached))
                        return
                    self._record_stat("cache_misses")
                except Exception as e:
                    logger.debug(f"Redis get failed (stock_quote:{sym}): {e}")

            try:
                in_fail_window = await self.redis_client.get(fail_key)
                if in_fail_window:
                    cached = await self.redis_client.get(quote_key)
                    if cached:
                        self._record_stat("fallback_cache_used")
                        results[sym] = self._normalize_quote(json.loads(cached))
                        return
            except Exception:
                pass

            # Fetch fresh
            quote = await self.get_quote(sym)
            if quote:
                try:
                    ttl = self._stock_quote_ttl_seconds()
                    await self.redis_client.setex(quote_key, ttl, json.dumps(quote))
                    await self.redis_client.setex(last_good_key, 86400, json.dumps(quote))
                except Exception as e:
                    logger.debug(f"Redis setex failed (stock_quote:{sym}): {e}")
                results[sym] = quote
                return

            # mark short failure window to avoid retry storms
            try:
                await self.redis_client.setex(fail_key, self.stock_quote_failure_ttl, "1")
            except Exception:
                pass

            # fallback priority: cache -> last good
            try:
                cached = await self.redis_client.get(quote_key)
                if cached:
                    self._record_stat("fallback_cache_used")
                    results[sym] = self._normalize_quote(json.loads(cached))
                    return
            except Exception:
                pass
            try:
                last_good = await self.redis_client.get(last_good_key)
                if last_good:
                    q = json.loads(last_good)
                    q["isStale"] = True
                    self._record_stat("fallback_lastgood_used")
                    results[sym] = self._normalize_quote(q)
            except Exception:
                pass

        # Wait for all quote fetches to resolve via asyncio gather
        await asyncio.gather(*(fetch_and_cache(s) for s in symbols))

        if not use_cache:
            for sym in symbols:
                if sym in results:
                    continue
                try:
                    cached = await self.redis_client.get(f'stock_quote:{sym}')
                    if cached:
                        results[sym] = json.loads(cached)
                except Exception as e:
                    logger.debug(f"Redis fallback after force refresh failed for stock {sym}: {e}")

        return results

    def get_metrics_snapshot(self) -> Dict[str, Any]:
        cache_hits = int(self._stats.get("cache_hits", 0))
        cache_misses = int(self._stats.get("cache_misses", 0))
        total_cache_reads = cache_hits + cache_misses
        cache_hit_rate = (cache_hits / total_cache_reads) if total_cache_reads else 0.0
        pre_total = int(self._stats.get("pre_market_coverage_total", 0))
        pre_available = int(self._stats.get("pre_market_coverage_available", 0))
        post_total = int(self._stats.get("post_market_coverage_total", 0))
        post_available = int(self._stats.get("post_market_coverage_available", 0))
        return {
            **self._stats,
            "cache_hit_rate": cache_hit_rate,
            "pre_market_coverage_rate": (pre_available / pre_total) if pre_total else 0.0,
            "post_market_coverage_rate": (post_available / post_total) if post_total else 0.0,
            "regular_only_mode_enabled": self._regular_only_mode_enabled(),
            "quote_ttl_active_s": self.stock_quote_ttl_active,
            "quote_ttl_closed_s": self.stock_quote_ttl_closed,
        }

    async def search_symbols(self, query: str) -> List[Dict[str, str]]:
        """
        Search for symbols using Yahoo Finance API with caching.
        """
        results = []
        if not query:
            return results

        # Check Cache
        query_lower = query.lower()
        try:
            cached = await self.redis_client.get(f'stock_search:{query_lower}')
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.debug(f"Redis get failed (stock_search:{query_lower}): {e}")

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
            try:
                await self.redis_client.setex(f'stock_search:{query_lower}', self.search_cache_duration, json.dumps(results))
            except Exception as e:
                logger.debug(f"Redis setex failed (stock_search:{query_lower}): {e}")

        except Exception as e:
            logger.error(f"Error searching via Yahoo Finance: {e}")

        return results

    async def get_popular_stocks(self) -> List[Dict[str, str]]:
        try:
            cached = await self.redis_client.get('stock_popular')
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.debug(f"Redis get failed (stock_popular): {e}")

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

            try:
                await self.redis_client.setex('stock_popular', self.search_cache_duration, json.dumps(popular))
            except Exception as e:
                logger.debug(f"Redis setex failed (stock_popular): {e}")
            return popular
        except Exception as e:
            logger.error(f"Error fetching popular stocks: {e}")
            return []


stock_service = StockService()
