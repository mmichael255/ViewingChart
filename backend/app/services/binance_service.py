import requests
from typing import List, Dict, Any
from datetime import datetime

class BinanceService:
    BASE_URL = "https://api.binance.com/api/v3"

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

binance_service = BinanceService()
