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
        
        url = f"{self.BASE_URL}/klines"
        params = {
            "symbol": symbol,
            "interval": interval,
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
