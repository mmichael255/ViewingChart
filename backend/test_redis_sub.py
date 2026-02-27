import redis
import json
import time
import sys

r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
p = r.pubsub()
p.subscribe("market:kline", "market:cmd_kline_sub", "market:ticker")

print("Listening to Redis...")
try:
    for message in p.listen():
        if message["type"] == "message":
            if message["channel"] == "market:kline":
                data = json.loads(message["data"])
                print(f"KLINE: {data['symbol']} {data['interval']} {data['data']['time']}")
            else:
                print(f"{message['channel']}: {message['data']}")
except KeyboardInterrupt:
    pass
