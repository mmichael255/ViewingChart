import yfinance as yf
from typing import List, Dict, Any

class StockService:
    def get_klines(self, symbol: str, interval: str = "1d", period: str = "1y") -> List[Dict[str, Any]]:
        """
        Fetch historical data from Yahoo Finance.
        """
        try:
            # yfinance expects symbols like 'AAPL', '0700.HK', '600519.SS'
            # Auto-select period based on interval to avoid Yahoo limits
            if interval == "1m":
                period = "7d"
            elif interval in ["2m", "5m", "15m", "30m", "90m"]:
                period = "59d" # 60d is the limit, use 59 to be safe
            elif interval in ["60m", "1h"]:
                period = "730d" # 2 years
            else:
                period = "max" # 1d, 1wk, 1mo use max available

            ticker = yf.Ticker(symbol)
            history = ticker.history(period=period, interval=interval)
            
            if history.empty:
                return []
            
            formatted_data = []
            for date, row in history.iterrows():
                # Lightweight charts expects seconds
                time_val = int(date.timestamp())
                
                formatted_data.append({
                    "time": time_val,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row["Volume"])
                })
                
            return formatted_data
        except Exception as e:
            print(f"Error fetching stock data for {symbol}: {e}")
            return []

stock_service = StockService()
