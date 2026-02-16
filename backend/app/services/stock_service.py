import yfinance as yf
from typing import List, Dict, Any

class StockService:
    def get_klines(self, symbol: str, interval: str = "1d", period: str = "1y") -> List[Dict[str, Any]]:
        """
        Fetch historical data from Yahoo Finance.
        """
        try:
            # yfinance expects symbols like 'AAPL', '0700.HK', '600519.SS'
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
