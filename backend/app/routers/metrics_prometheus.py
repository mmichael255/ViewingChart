"""
Prometheus scrape endpoint. Gauges reflect ConnectionManager state at scrape time.
"""

import time

from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, generate_latest

from app.services.websocket_manager import manager

router = APIRouter(tags=["metrics"])

_g_binance_spot_connected = Gauge(
    "viewingchart_binance_spot_connected",
    "1 if Binance spot upstream WebSocket is connected",
)
_g_binance_futures_connected = Gauge(
    "viewingchart_binance_futures_connected",
    "1 if Binance futures upstream WebSocket is connected",
)
_g_binance_last_message_age_seconds = Gauge(
    "viewingchart_binance_last_message_age_seconds",
    "Seconds since last message from Binance upstream (0 if never)",
)
_g_binance_spot_reconnects_total = Gauge(
    "viewingchart_binance_spot_reconnects_total",
    "Cumulative spot upstream reconnects since process start",
)
_g_binance_futures_reconnects_total = Gauge(
    "viewingchart_binance_futures_reconnects_total",
    "Cumulative futures upstream reconnects since process start",
)
_g_active_kline_streams = Gauge(
    "viewingchart_active_kline_streams",
    "Number of kline stream names subscribed on Binance upstream",
)
_g_ws_kline_clients = Gauge(
    "viewingchart_ws_kline_clients",
    "Browser WebSocket clients subscribed to kline rooms",
)
_g_ws_ticker_clients = Gauge(
    "viewingchart_ws_ticker_clients",
    "Browser WebSocket clients on the ticker multiplex",
)
_g_global_watchlist_size = Gauge(
    "viewingchart_global_watchlist_symbols",
    "Symbols in the merged ticker watchlist",
)
_g_ticker_streams_spot = Gauge(
    "viewingchart_ticker_streams_spot",
    "Individual @ticker streams subscribed on spot upstream",
)
_g_ticker_streams_futures = Gauge(
    "viewingchart_ticker_streams_futures",
    "Individual @ticker streams subscribed on futures upstream",
)
_g_kline_room_count = Gauge(
    "viewingchart_kline_room_count",
    "Distinct symbol_interval kline rooms with at least one client",
)


@router.get("/metrics")
async def prometheus_metrics():
    s = manager.get_status()
    now = time.time()

    _g_binance_spot_connected.set(1.0 if s["spot_connected"] else 0.0)
    _g_binance_futures_connected.set(1.0 if s["futures_connected"] else 0.0)

    age = s.get("last_message_age_s")
    if age is None and s.get("last_message_ts"):
        age = round(now - float(s["last_message_ts"]), 1)
    if age is None:
        _g_binance_last_message_age_seconds.set(0.0)
    else:
        _g_binance_last_message_age_seconds.set(float(age))

    _g_binance_spot_reconnects_total.set(float(s["spot_reconnect_count"]))
    _g_binance_futures_reconnects_total.set(float(s["futures_reconnect_count"]))
    _g_active_kline_streams.set(float(s["active_streams"]))
    _g_ws_kline_clients.set(float(s["kline_client_count"]))
    _g_ws_ticker_clients.set(float(s["ticker_client_count"]))

    _g_global_watchlist_size.set(float(s.get("global_watchlist_size", 0)))
    tc = s.get("ticker_stream_counts") or {}
    _g_ticker_streams_spot.set(float(tc.get("spot", 0)))
    _g_ticker_streams_futures.set(float(tc.get("futures", 0)))
    _g_kline_room_count.set(float(s.get("kline_room_count", 0)))

    data = generate_latest()
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)
