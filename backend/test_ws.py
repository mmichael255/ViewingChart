import asyncio
import websockets

async def test():
    url = "wss://stream.binance.com:9443/ws/btcusdt@kline_1m/!ticker@arr"
    print(f"Connecting to {url}")
    try:
        async with websockets.connect(url) as ws:
            print("Connected. Waiting for msg...")
            msg = await ws.recv()
            print(f"Received: {msg[:100]}")
    except Exception as e:
        print(f"Exception: {repr(e)}")

asyncio.run(test())
