import time
import httpx
import json
import asyncio
import redis.asyncio as redis
import yfinance as yf
from typing import List, Dict, Any, Tuple
from app.config import settings

class StockService:
    def __init__(self):
        self.alphavantage_api_key = settings.ALPHA_VANTAGE_API_KEY
        
        if not self.alphavantage_api_key or self.alphavantage_api_key == "demo":
            print("WARNING: ALPHAVANTAGE_API_KEY not properly configured in .env file")
            
        self.redis_client = redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0, decode_responses=True)
        self.cache_duration = 60 # seconds, slightly longer to avoid Alpha Vantage rate limits
        self.search_cache_duration = 3600 # Cache searches for 1 hour
        
    def _is_alphavantage_symbol(self, symbol: str) -> bool:
        """
        Determine if a symbol should be routed to Alpha Vantage (FX/Metals)
        instead of yfinance.
        """
        # Common FX/Crypto format for yfinance is EURUSD=X or BTC-USD
        # But for UI consistency, the user might pass them differently.
        # Let's assume if it contains a '/' like 'EUR/USD' or Ends with '=X', 
        # or if it's explicitly one of the known metal symbols.
        
        if symbol.endswith("=X"):
            return True
        if "/" in symbol:
            return True
        # Simple heuristic: If it starts with XAU, XAG, etc.
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
            # Just an example, can be tweaked based on exact input format
            return "FX", sym[:3], sym[3:]
            
        # Default fallback, assume it's like EURUSD
        if len(sym) == 6:
             return "FX", sym[:3], sym[3:]
             
        return "UNKNOWN", sym, ""

    def _map_yf_interval(self, interval: str) -> str:
        """Map frontend interval to yfinance interval."""
        mapping = {
            "1m": "1m",
            "3m": "2m", # yf doesn't have 3m, fallback to 2m
            "5m": "5m",
            "15m": "15m",
            "30m": "30m",
            "1h": "60m",
            "4h": "60m", # yf doesn't support 4h well, fallback to 60m (could resample, but keep simple for now)
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
            "4h": "60min", # AV max intraday is 60min
            # Daily and above use different endpoints in AV
            "1d": "DAILY",
            "1w": "WEEKLY",
            "1M": "MONTHLY"
        }
        return mapping.get(interval, "DAILY")

    async def _get_yf_klines(self, symbol: str, interval: str, limit: int = 1000) -> List[Dict[str, Any]]:
        yf_interval = self._map_yf_interval(interval)
        
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
            
        # Return only the requested limit
        return formatted_data[-limit:]

    async def _get_av_klines(self, symbol: str, interval: str, limit: int = 1000) -> List[Dict[str, Any]]:
        if not self.alphavantage_api_key:
            print("Alpha Vantage API key missing")
            return []
            
        av_interval = self._map_av_interval(interval)
        ftype, from_sym, to_sym = self._format_alphavantage_symbol(symbol)
        
        url = "https://www.alphavantage.co/query"
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
             params["outputsize"] = "full" # get more history
             data_key = f"Time Series FX ({av_interval})"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
            
            if "Note" in data:
                print(f"Alpha Vantage limit reached: {data['Note']}")
                return []
                
            if "Error Message" in data:
                 print(f"Alpha Vantage error: {data['Error Message']}")
                 return []
                 
            series_data = data.get(data_key, {})
            
            formatted_data = []
            
            # Alpha Vantage returns string timestamps, we need to parse them
            # Format is usually 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD'
            from datetime import datetime
            import pytz
            
            for timestamp_str, values in series_data.items():
                try:
                    # Intraday has time, daily does not
                    if len(timestamp_str) > 10:
                        dt = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")
                    else:
                        dt = datetime.strptime(timestamp_str, "%Y-%m-%d")
                        
                    # AV is generally US/Eastern
                    tz = pytz.timezone('US/Eastern')
                    dt = tz.localize(dt)
                    
                    formatted_data.append({
                        "time": int(dt.timestamp()),
                        "open": float(values["1. open"]),
                        "high": float(values["2. high"]),
                        "low": float(values["3. low"]),
                        "close": float(values["4. close"]),
                        "volume": 0 # FX doesn't generally have volume in AV free tier
                    })
                except Exception as e:
                    print(f"Error parsing date {timestamp_str}: {e}")
            
            # AV returns data newest-first, we need oldest-first
            formatted_data.reverse()
            return formatted_data[-limit:]
            
        except Exception as e:
            print(f"Error fetching Alpha Vantage data: {e}")
            return []

    async def get_klines(self, symbol: str, interval: str = "4h", limit: int = 1000) -> List[Dict[str, Any]]:
        """
        Fetch historical kline data routing to yfinance or Alpha Vantage.
        """
        if self._is_alphavantage_symbol(symbol):
             return await self._get_av_klines(symbol, interval, limit)
        else:
             return await self._get_yf_klines(symbol, interval, limit)

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        """
        Fetch real-time quote for a single asset.
        """
        if self._is_alphavantage_symbol(symbol):
            # Alpha Vantage Realtime FX
            ftype, from_sym, to_sym = self._format_alphavantage_symbol(symbol)
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "CURRENCY_EXCHANGE_RATE",
                "from_currency": from_sym,
                "to_currency": to_sym,
                "apikey": self.alphavantage_api_key
            }
            try:
                async with httpx.AsyncClient() as client:
                    res = (await client.get(url, params=params)).json()
                    if "Realtime Currency Exchange Rate" in res:
                        rate = float(res["Realtime Currency Exchange Rate"]["5. Exchange Rate"])
                        return {
                            "lastPrice": rate,
                            "priceChange": 0, # AV free tier doesn't easily give 24h change here
                            "priceChangePercent": 0
                        }
            except Exception as e:
                 print(f"AV Quote Error: {symbol} - {e}")
            return {}
        else:
            # yfinance quote
            def fetch_yfinance_quote():
                try:
                    ticker = yf.Ticker(symbol)
                    
                    try: # Fast info sometimes throws NoneType exceptions
                        last_price = ticker.fast_info.last_price
                        prev_close = ticker.fast_info.previous_close
                    except Exception:
                        # Fallback to fetching recent history
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
                    print(f"yfinance Quote Error for {symbol}: {e}")
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

        # Wait for all quote fetches to resolve securely via asyncio gather
        await asyncio.gather(*(fetch_and_cache(s) for s in symbols))
                
        return results

    async def search_symbols(self, query: str) -> List[Dict[str, str]]:
        """
        Search for symbols using yfinance and cache results.
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
            url = f"https://query2.finance.yahoo.com/v1/finance/search"
            params = {"q": query, "quotesCount": 50, "newsCount": 0}
            headers = {"User-Agent": "Mozilla/5.0"}
            
            async with httpx.AsyncClient() as client:
                res = await client.get(url, params=params, headers=headers)
                res.raise_for_status()
                data = res.json()
                
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
            print(f"Error searching via Yahoo Finance: {e}")

        return results

    async def get_popular_stocks(self) -> List[Dict[str, str]]:
        cached = await self.redis_client.get('stock_popular')
        if cached:
            return json.loads(cached)

        try:
            url = "https://query2.finance.yahoo.com/v1/finance/trending/US"
            headers = {"User-Agent": "Mozilla/5.0"}
            async with httpx.AsyncClient() as client:
                res = await client.get(url, headers=headers)
                res.raise_for_status()
                data = res.json()
                
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

            popular = []
            for sym in syms:
                short_name = await asyncio.to_thread(lambda s=sym: extract_name(s))
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
            print(f"Error fetching popular stocks: {e}")
            return []

stock_service = StockService()
