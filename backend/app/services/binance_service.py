import httpx
import json
import time
import redis.asyncio as redis
from typing import List, Dict, Any, Optional
from app.config import settings

class BinanceService:
    BASE_URL = settings.BINANCE_API_URL

    def __init__(self):
        # Connect to Valkey/Redis
        self.redis_client = redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0, decode_responses=True)
        self.cache_duration = 3600  # 1 hour

    async def _fetch_exchange_info(self) -> List[Dict[str, str]]:
        """Fetch and cache trading pairs from Binance exchange info."""
        cached = await self.redis_client.get('binance:symbols')
        if cached:
            return json.loads(cached)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.BASE_URL}/exchangeInfo")
                response.raise_for_status()
                data = response.json()
                
                # Filter for trading pairs only (TRADING status)
                symbols = []
                for symbol_info in data.get("symbols", []):
                    if symbol_info.get("status") == "TRADING":
                        symbols.append({
                            "symbol": symbol_info["symbol"],
                            "baseAsset": symbol_info["baseAsset"],
                            "quoteAsset": symbol_info["quoteAsset"]
                        })
                        
                await self.redis_client.setex('binance:symbols', self.cache_duration, json.dumps(symbols))
                return symbols
        except Exception as e:
            print(f"Error fetching exchange info from Binance: {e}")
            return []

    async def search_symbols(self, query: str, limit: int = 50) -> List[Dict[str, str]]:
        """Search cached symbols by symbol name or base asset."""
        symbols = await self._fetch_exchange_info()
        
        if not query:
            return symbols[:limit]
            
        query = query.upper()
        results = []
        
        # Exact match pattern or starting with
        for s in symbols:
            symbol_name = s["symbol"].upper()
            base_asset = s["baseAsset"].upper()
            
            if query in symbol_name or query == base_asset:
                result_item = s.copy()
                result_item["source"] = "Binance Futures" if symbol_name in ["XAUUSDT", "XAGUSDT"] else "Binance"
                results.append(result_item)
                
            if len(results) >= limit:
                break
                
        return results

    async def get_popular_cryptos(self) -> List[Dict[str, str]]:
        cached = await self.redis_client.get('binance:popular')
        if cached:
            return json.loads(cached)

        try:
            async with httpx.AsyncClient() as client:
                # Fetch 24hr ticker to determine popularity by volume
                res = await client.get(f"{self.BASE_URL}/ticker/24hr")
                res.raise_for_status()
                data = res.json()
                
                # Filter USDT pairs
                usdt_pairs = [d for d in data if d["symbol"].endswith("USDT") and "UPUSDT" not in d["symbol"] and "DOWNUSDT" not in d["symbol"]]
                
                # Sort by quoteVolume descending
                usdt_pairs.sort(key=lambda x: float(x.get("quoteVolume", 0)), reverse=True)
                
                # Select top 25
                top = usdt_pairs[:25]
                popular = []
                for t in top:
                    sym = t["symbol"]
                    popular.append({
                        "symbol": sym,
                        "baseAsset": sym.replace("USDT", ""),
                        "quoteAsset": "USDT",
                        "source": "Binance"
                    })
                
                # Append Gold and Silver Futures since spot API won't hit them
                popular.append({"symbol": "XAUUSDT", "baseAsset": "XAU", "quoteAsset": "USDT", "source": "Binance Futures"})
                popular.append({"symbol": "XAGUSDT", "baseAsset": "XAG", "quoteAsset": "USDT", "source": "Binance Futures"})
                
                await self.redis_client.setex('binance:popular', self.cache_duration, json.dumps(popular))
                return popular
        except Exception as e:
            print(f"Error fetching popular cryptos: {e}")
            return []

    async def get_klines(self, symbol: str, interval: str = "1h", limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetch K-line data from Binance.
        """
        symbol = symbol.upper()
        
        # Map user intervals to Binance supported intervals
        interval_map = {
            "60m": "1h",
            "90m": "1h", # Fallback
            "2m": "1m",  # Fallback
            "5d": "1w",  # Fallback
            "1wk": "1w",
            "1mo": "1M",
            "3mo": "1M", # Fallback
        }
        
        binance_interval = interval_map.get(interval, interval)
        
        if symbol in ["XAUUSDT", "XAGUSDT"]:
            url = f"{settings.BINANCE_FUTURES_API_URL}/klines"
        else:
            url = f"{self.BASE_URL}/klines"
            
        params = {
            "symbol": symbol,
            "interval": binance_interval,
            "limit": limit
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                
                formatted_data = []
                for candle in data:
                    formatted_data.append({
                        "time": int(candle[0] / 1000), 
                        "open": float(candle[1]),
                        "high": float(candle[2]),
                        "low": float(candle[3]),
                        "close": float(candle[4]),
                        "volume": float(candle[5]) 
                    })
                    
                return formatted_data
        except Exception as e:
            print(f"Error fetching data from Binance: {e}")
            return []

    async def get_ticker_24h(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Fetch 24hr ticker price change statistics for multiple symbols async.
        """
        if not symbols:
            return {}

        spot_symbols = [s for s in symbols if s.upper() not in ["XAUUSDT", "XAGUSDT"]]
        futures_symbols = [s for s in symbols if s.upper() in ["XAUUSDT", "XAGUSDT"]]

        result = {}

        async with httpx.AsyncClient() as client:
            # Fetch spot symbols 
            if spot_symbols:
                try:
                    spot_str = json.dumps([s.upper() for s in spot_symbols], separators=(',', ':'))
                    url = f"{self.BASE_URL}/ticker/24hr"
                    response = await client.get(url, params={"symbols": spot_str}, timeout=15.0)
                    response.raise_for_status()
                    for ticker in response.json():
                        symbol = ticker["symbol"].upper()
                        result[symbol] = {
                            "lastPrice": float(ticker["lastPrice"]),
                            "priceChange": float(ticker["priceChange"]),
                            "priceChangePercent": float(ticker["priceChangePercent"])
                        }
                except Exception as e:
                    print(f"Error fetching spot 24hr ticker from Binance: {e}")

            # Fetch futures symbols 
            if futures_symbols:
                try:
                    fut_str = json.dumps([s.upper() for s in futures_symbols], separators=(',', ':'))
                    url = f"{settings.BINANCE_FUTURES_API_URL}/ticker/24hr"
                    response = await client.get(url, params={"symbols": fut_str}, timeout=15.0)
                    response.raise_for_status()
                    for ticker in response.json():
                        symbol = ticker["symbol"].upper()
                        result[symbol] = {
                            "lastPrice": float(ticker["lastPrice"]),
                            "priceChange": float(ticker["priceChange"]),
                            "priceChangePercent": float(ticker["priceChangePercent"])
                        }
                except Exception as e:
                    print(f"Error fetching futures 24hr ticker from Binance: {e}")

        return result

binance_service = BinanceService()
