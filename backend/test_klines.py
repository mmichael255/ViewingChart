import asyncio
from app.services.binance_service import binance_service

async def main():
    try:
        data = await binance_service.get_klines("BTCUSDT", "1d", 100)
        print(f"Got {len(data)} items")
    except Exception as e:
        print(f"Exception: {repr(e)}")

if __name__ == "__main__":
    asyncio.run(main())
