import requests
import time
from typing import List, Dict, Any, Optional
from datetime import datetime

class BinanceService:
    BASE_URL = "https://api.binance.com/api/v3"

    def __init__(self):
        self.symbols_cache: List[Dict[str, str]] = []
        self.symbols_last_fetched: float = 0
        self.cache_duration = 3600  # 1 hour

    def _fetch_exchange_info(self) -> None:
        """Fetch and cache trading pairs from Binance exchange info."""
        current_time = time.time()
        if self.symbols_cache and (current_time - self.symbols_last_fetched < self.cache_duration):
            return

        try:
            response = requests.get(f"{self.BASE_URL}/exchangeInfo")
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
                    
            self.symbols_cache = symbols
            self.symbols_last_fetched = current_time
        except Exception as e:
            print(f"Error fetching exchange info from Binance: {e}")

    def search_symbols(self, query: str, limit: int = 10) -> List[Dict[str, str]]:
        """Search cached symbols by symbol name or base asset."""
        self._fetch_exchange_info()
        
        if not query:
            return self.symbols_cache[:limit]
            
        query = query.upper()
        results = []
        
        # Exact match pattern or starting with
        for s in self.symbols_cache:
            symbol_name = s["symbol"].upper()
            base_asset = s["baseAsset"].upper()
            
            if query in symbol_name or query == base_asset:
                results.append(s)
                
            if len(results) >= limit:
                break
                
        return results

    def get_klines(self, symbol: str, interval: str = "1h", limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetch K-line data from Binance.
        avg response: [[1499040000000, "0.01634790", ...], ...]
        """
        # Ensure symbol is uppercase
        symbol = symbol.upper()
        
        # Map user intervals to Binance supported intervals
        # Supported: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
        interval_map = {
            "60m": "1h",
            "90m": "1h", # Fallback
            "2m": "1m",  # Fallback
            "5d": "1w",  # Fallback
            "1wk": "1w",
            "1mo": "1M",
            "3mo": "1M", # Fallback
        }
        
        # Use mapped interval if exists, else use original (assuming it's valid or close enough)
        binance_interval = interval_map.get(interval, interval)
        
        url = f"{self.BASE_URL}/klines"
        params = {
            "symbol": symbol,
            "interval": binance_interval,
            "limit": limit
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            # Format for Lightweight Charts (time in seconds, OHLC floats)
            formatted_data = []
            for candle in data:
                # Binance columns: 0:Open time, 1:Open, 2:High, 3:Low, 4:Close, 5:Volume, ...
                formatted_data.append({
                    "time": int(candle[0] / 1000), # Convert ms to seconds
                    "open": float(candle[1]),
                    "high": float(candle[2]),
                    "low": float(candle[3]),
                    "close": float(candle[4]),
                    "volume": float(candle[5]) # Optional, but good to have
                })
                
            return formatted_data
        except Exception as e:
            print(f"Error fetching data from Binance: {e}")
            return []

    def get_ticker_24h(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Fetch 24hr ticker price change statistics for multiple symbols.
        """
        import json

        if not symbols:
            return {}

        spot_symbols = [s for s in symbols if s.upper() not in ["XAUUSDT", "XAGUSDT"]]
        futures_symbols = [s for s in symbols if s.upper() in ["XAUUSDT", "XAGUSDT"]]

        result = {}

        # Fetch spot symbols independently
        if spot_symbols:
            try:
                spot_str = json.dumps([s.upper() for s in spot_symbols], separators=(',', ':'))
                url = f"{self.BASE_URL}/ticker/24hr"
                response = requests.get(url, params={"symbols": spot_str}, timeout=15.0)
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

        # Fetch futures symbols independently
        if futures_symbols:
            try:
                fut_str = json.dumps([s.upper() for s in futures_symbols], separators=(',', ':'))
                url = "https://fapi.binance.com/fapi/v1/ticker/24hr"
                response = requests.get(url, params={"symbols": fut_str}, timeout=15.0)
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
