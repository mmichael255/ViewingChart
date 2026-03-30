"""
Persist and read klines from MariaDB. Used by the API: DB first, merge latest API tail for live closes.
"""
import asyncio
import logging
import time
from typing import Any

from sqlalchemy.dialects.mysql import insert as mysql_insert

from app.database.connection import SessionLocal
from app.database.models import Symbol, Kline
from app.services.binance_service import binance_service
from app.services.stock_service import stock_service

logger = logging.getLogger(__name__)

# Recent bars from API merged into DB-backed response so last candle close stays current.
TAIL_API_LIMIT = 24
# Max candles to request when bridging DB staleness (Binance paginates; stocks may return less).
MAX_GAP_FILL_BARS = 10_000

# Binance-style intervals -> seconds (approximate 1M for gap heuristics only).
_BAR_INTERVAL_SECONDS: dict[str, int] = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14_400,
    "1d": 86_400,
    "1w": 604_800,
    "1M": 30 * 86_400,
}


def _bar_interval_seconds(bar_interval: str) -> int | None:
    return _BAR_INTERVAL_SECONDS.get(bar_interval)


def _gap_aware_api_fetch_limit(bar_interval: str, newest_db_open_time: int) -> int:
    """
    How many most-recent candles to pull from the API so the oldest in that batch
    reaches (or passes) the bar after newest_db_open_time, closing a hole when the
    DB fell behind by more than TAIL_API_LIMIT bars.
    """
    ise = _bar_interval_seconds(bar_interval)
    if not ise:
        return TAIL_API_LIMIT
    now = int(time.time())
    t_next = newest_db_open_time + ise
    if now < t_next:
        return TAIL_API_LIMIT
    bars_behind = (now - t_next) // ise + 2
    return min(MAX_GAP_FILL_BARS, max(TAIL_API_LIMIT, bars_behind))


def use_stock_kline_api(symbol: str, asset_type: str) -> bool:
    return asset_type == "stock" and not (
        symbol.startswith("XAU") or symbol.startswith("XAG")
    )


def infer_symbol_row(symbol: str, asset_type: str) -> dict[str, Any]:
    """Minimal symbol row when backfilling a symbol not yet in DB."""
    if asset_type == "stock":
        if "=" in symbol:
            sym = symbol.upper().replace("=X", "")
            base = sym[:3] if len(sym) >= 6 else symbol
            quote = sym[3:6] if len(sym) >= 6 else "USD"
        else:
            base = symbol
            quote = "USD"
        return {
            "symbol": symbol,
            "base_asset": base,
            "quote_asset": quote,
            "asset_type": "stock",
            "source": "Yahoo Finance",
            "name": None,
        }
    if symbol.endswith("USDT"):
        return {
            "symbol": symbol,
            "base_asset": symbol[:-4],
            "quote_asset": "USDT",
            "asset_type": "crypto",
            "source": "Binance",
            "name": None,
        }
    if symbol.endswith("USDC"):
        return {
            "symbol": symbol,
            "base_asset": symbol[:-4],
            "quote_asset": "USDC",
            "asset_type": "crypto",
            "source": "Binance",
            "name": None,
        }
    return {
        "symbol": symbol,
        "base_asset": symbol,
        "quote_asset": "USDT",
        "asset_type": "crypto",
        "source": "Binance Futures",
        "name": None,
    }


def _to_unix_seconds(t: Any) -> int:
    val = int(float(t))
    return val // 1000 if val > 1e12 else val


def _normalize_api_candle(k: dict) -> dict[str, Any]:
    """API / frontend shape (time, open, high, low, close, volume)."""
    return {
        "time": _to_unix_seconds(k["time"]),
        "open": float(k["open"]),
        "high": float(k["high"]),
        "low": float(k["low"]),
        "close": float(k["close"]),
        "volume": float(k["volume"]),
    }


def merge_db_with_api_tail(
    db_rows: list[dict],
    api_tail: list[dict],
    limit: int,
) -> list[dict]:
    """Overlay latest API candles on DB series so forming bar close updates."""
    by_time: dict[int, dict[str, Any]] = {}
    for x in db_rows:
        t = _to_unix_seconds(x["time"])
        by_time[t] = _normalize_api_candle({**x, "time": t})
    for k in api_tail:
        n = _normalize_api_candle(k)
        by_time[n["time"]] = n
    ordered_ts = sorted(by_time.keys())
    merged = [by_time[t] for t in ordered_ts]
    return merged[-limit:] if len(merged) > limit else merged


def upsert_symbol(db, row: dict) -> None:
    stmt = mysql_insert(Symbol).values(
        symbol=row["symbol"],
        base_asset=row["base_asset"],
        quote_asset=row["quote_asset"],
        asset_type=row["asset_type"],
        source=row["source"],
        name=row.get("name"),
    )
    stmt = stmt.on_duplicate_key_update(
        base_asset=stmt.inserted.base_asset,
        quote_asset=stmt.inserted.quote_asset,
        source=stmt.inserted.source,
        name=stmt.inserted.name,
    )
    db.execute(stmt)
    db.commit()


def save_klines(db, symbol_id: int, bar_interval: str, klines: list[dict]) -> int:
    if not klines:
        return 0
    rows = [
        {
            "symbol_id": symbol_id,
            "bar_interval": bar_interval,
            "open_time": _to_unix_seconds(k["time"]),
            "open_price": k["open"],
            "high_price": k["high"],
            "low_price": k["low"],
            "close_price": k["close"],
            "base_volume": k["volume"],
        }
        for k in klines
    ]
    stmt = mysql_insert(Kline).values(rows)
    stmt = stmt.on_duplicate_key_update(
        open_price=stmt.inserted.open_price,
        high_price=stmt.inserted.high_price,
        low_price=stmt.inserted.low_price,
        close_price=stmt.inserted.close_price,
        base_volume=stmt.inserted.base_volume,
    )
    db.execute(stmt)
    db.commit()
    return len(rows)


def _kline_to_api_dict(row: Kline) -> dict[str, Any]:
    return {
        "time": row.open_time,
        "open": float(row.open_price),
        "high": float(row.high_price),
        "low": float(row.low_price),
        "close": float(row.close_price),
        "volume": float(row.base_volume),
    }


def load_klines_from_db(
    db,
    symbol: str,
    asset_type: str,
    bar_interval: str,
    limit: int,
) -> list[dict]:
    """Most recent `limit` candles, ascending by time (chart order)."""
    sym = (
        db.query(Symbol)
        .filter(Symbol.symbol == symbol, Symbol.asset_type == asset_type)
        .first()
    )
    if not sym:
        return []
    q = (
        db.query(Kline)
        .filter(Kline.symbol_id == sym.id, Kline.bar_interval == bar_interval)
        .order_by(Kline.open_time.desc())
        .limit(limit)
    )
    rows = list(q.all())
    if not rows:
        return []
    rows.reverse()
    return [_kline_to_api_dict(r) for r in rows]


def _sync_backfill_and_read(
    symbol: str,
    asset_type: str,
    bar_interval: str,
    limit: int,
    api_data: list[dict],
) -> list[dict]:
    db = SessionLocal()
    try:
        upsert_symbol(db, infer_symbol_row(symbol, asset_type))
        sym = (
            db.query(Symbol)
            .filter(Symbol.symbol == symbol, Symbol.asset_type == asset_type)
            .first()
        )
        if not sym:
            return api_data
        save_klines(db, sym.id, bar_interval, api_data)
        return load_klines_from_db(db, symbol, asset_type, bar_interval, limit) or api_data
    except Exception as e:
        logger.exception("klines DB backfill failed: %s", e)
        return api_data
    finally:
        db.close()


def _sync_read_only(
    symbol: str, asset_type: str, bar_interval: str, limit: int
) -> list[dict]:
    db = SessionLocal()
    try:
        return load_klines_from_db(db, symbol, asset_type, bar_interval, limit)
    finally:
        db.close()


def _sync_persist_tail(
    symbol: str,
    asset_type: str,
    bar_interval: str,
    api_tail: list[dict],
) -> None:
    if not api_tail:
        return
    db = SessionLocal()
    try:
        upsert_symbol(db, infer_symbol_row(symbol, asset_type))
        sym = (
            db.query(Symbol)
            .filter(Symbol.symbol == symbol, Symbol.asset_type == asset_type)
            .first()
        )
        if sym:
            save_klines(db, sym.id, bar_interval, api_tail)
    except Exception as e:
        logger.debug("persist kline tail skipped: %s", e)
    finally:
        db.close()


async def fetch_klines_from_api(
    symbol: str, asset_type: str, bar_interval: str, limit: int
) -> list[dict]:
    if use_stock_kline_api(symbol, asset_type):
        return await stock_service.get_klines(
            symbol, interval=bar_interval, limit=limit
        )
    return await binance_service.get_klines(
        symbol, interval=bar_interval, limit=limit
    )


async def get_klines_db_first(
    symbol: str,
    bar_interval: str,
    asset_type: str,
    limit: int = 5000,
) -> list[dict] | None:
    """
    Read klines from DB. If none exist, backfill from API.

    When DB has data, merge in API candles: if the newest DB bar is stale relative
    to wall clock and interval length, fetch enough history to bridge the gap (capped
    at MAX_GAP_FILL_BARS); otherwise fetch a short tail only. Merged bars are upserted.
    """
    cached = await asyncio.to_thread(
        _sync_read_only, symbol, asset_type, bar_interval, limit
    )
    if cached:
        api_tail: list[dict] = []
        newest_db_t = _to_unix_seconds(cached[-1]["time"])
        fetch_n = _gap_aware_api_fetch_limit(bar_interval, newest_db_t)
        if fetch_n > TAIL_API_LIMIT:
            logger.info(
                "klines gap fill %s %s @ %s: fetching %d API bars (DB newest open_time=%s)",
                symbol,
                asset_type,
                bar_interval,
                fetch_n,
                newest_db_t,
            )
        try:
            api_tail = await fetch_klines_from_api(
                symbol, asset_type, bar_interval, limit=fetch_n
            )
        except Exception as e:
            logger.debug("API tail fetch failed (non-fatal): %s", e)
        merged = merge_db_with_api_tail(cached, api_tail, limit)
        if api_tail:
            await asyncio.to_thread(
                _sync_persist_tail, symbol, asset_type, bar_interval, api_tail
            )
        return merged

    api_data = await fetch_klines_from_api(
        symbol, asset_type, bar_interval, limit=limit
    )
    if not api_data:
        return None

    logger.info(
        "Backfilling klines into DB: %s %s @ %s (%d candles)",
        symbol,
        asset_type,
        bar_interval,
        len(api_data),
    )
    return await asyncio.to_thread(
        _sync_backfill_and_read,
        symbol,
        asset_type,
        bar_interval,
        limit,
        api_data,
    )
