import requests
import os
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

class StockService:
    def __init__(self):
        self.api_url = os.getenv("ITICK_API_URL", "https://api.itick.org")
        self.api_token = os.getenv("ITICK_API_TOKEN", "")
        
        if not self.api_token:
            print("WARNING: ITICK_API_TOKEN not set in .env file")
    
    def _get_region_and_code(self, symbol: str) -> tuple[str, str]:
        """
        Convert Yahoo-style symbols to iTick format.
        Examples:
        - AAPL -> (US, AAPL)
        - 0700.HK -> (HK, 00700)
        - 600519.SS -> (CN, 600519)
        """
        if ".HK" in symbol:
            code = symbol.replace(".HK", "")
            return "HK", code
        elif ".SH" in symbol:
            code = symbol.replace(".SH", "")
            return "SH", code
        else:
            # Assume US stock
            return "US", symbol
    
    def _map_interval_to_ktype(self, interval: str) -> int:
        """
        Map user-friendly interval to iTick kType.
        kType values:
        1 = 1 minute
        2 = 5 minutes
        3 = 15 minutes
        4 = 30 minutes
        5 = 1 hour
        6 = 1 day (NOTE: May not be available for all stocks)
        7 = 1 week
        10 = 1 month
        """
        interval_map = {
            "1m": 1,
            "5m": 2,
            "15m": 3,
            "30m": 4,
            "1h": 5,
        }
        return interval_map.get(interval, 2)  # Default to 5min
    
    def get_klines(self, symbol: str, interval: str = "1h", limit: int = 1000) -> List[Dict[str, Any]]:
        """
        Fetch historical kline data from iTick API.
        """
        try:
            region, code = self._get_region_and_code(symbol)
            ktype = self._map_interval_to_ktype(interval)
            
            url = f"{self.api_url}/stock/kline"
            headers = {
                "accept": "application/json",
                "token": self.api_token
            }
            params = {
                "region": region,  # iTick uses uppercase regions (US, HK, CN)
                "code": code,
                "kType": ktype,
                "limit": limit
            }
            
            response = requests.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            
            # iTick response format: {code, data: [{t, o, h, l, c, v, tu}]}
            if not data or "data" not in data or not data["data"]:
                return []
            
            formatted_data = []
            for candle in data["data"]:
                # iTick returns: t (timestamp ms), o (open), h (high), l (low), c (close), v (volume)
                formatted_data.append({
                    "time": int(candle["t"] / 1000),  # Convert ms to seconds
                    "open": float(candle["o"]),
                    "high": float(candle["h"]),
                    "low": float(candle["l"]),
                    "close": float(candle["c"]),
                    "volume": float(candle["v"])
                })
            
            return formatted_data
            
        except Exception as e:
            print(f"Error fetching stock data from iTick for {symbol}: {e}")
            return []

stock_service = StockService()
