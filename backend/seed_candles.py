#!/usr/bin/env python3
import argparse
import asyncio
from datetime import UTC, datetime
import json
import logging
import time
from typing import Any

import websockets
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.database.connection import SessionLocal
from app.database.models import Kline, Symbol
from app.services.klines_db_service import (
    fetch_klines_from_api,
    infer_symbol_row,
    save_klines,
    upsert_symbol,
)

logger = logging.getLogger("seed_candles")

_INTERVAL_SECONDS = {
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


def _fmt_ts(ts: int | None) -> str:
    if ts is None:
        return "n/a"
    return datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")


def _parse_human_ts(value: str) -> int:
    """
    Parse yyyymmddHHmmss (24h) into unix seconds (UTC).
    """
    try:
        dt = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=UTC)
    except ValueError as e:
        raise ValueError(
            f"Invalid time '{value}', expected format yyyymmddHHmmss (e.g. 20260131235959)"
        ) from e
    return int(dt.timestamp())


def _range_of_open_times(klines: list[dict[str, Any]]) -> tuple[int | None, int | None]:
    if not klines:
        return None, None
    times = [int(k["time"]) for k in klines]
    return min(times), max(times)


def _missing_span(left_t: int, right_t: int, step: int) -> tuple[int | None, int | None]:
    start = left_t + step
    end = right_t - step
    if start > end:
        return None, None
    return start, end


def _scan_internal_gaps_segmented(
    db,
    symbol_id: int,
    interval: str,
    step: int,
    batch_size: int,
    scan_start_time: int | None = None,
    scan_end_time: int | None = None,
) -> tuple[list[tuple[int, int, int]], int, int | None, int | None]:
    """
    Scan all DB history in ascending open_time order using segmented reads.
    Returns: (gaps, rows_scanned, first_open_time, last_open_time)
    """
    gaps: list[tuple[int, int, int]] = []
    rows_scanned = 0
    first_open_time: int | None = None
    last_open_time: int | None = None
    prev_t: int | None = None
    cursor_after: int | None = None

    while True:
        q = (
            db.query(Kline.open_time)
            .filter(Kline.symbol_id == symbol_id, Kline.bar_interval == interval)
            .order_by(Kline.open_time.asc())
        )
        if scan_start_time is not None:
            q = q.filter(Kline.open_time >= scan_start_time)
        if scan_end_time is not None:
            q = q.filter(Kline.open_time <= scan_end_time)
        if cursor_after is not None:
            q = q.filter(Kline.open_time > cursor_after)
        q = q.limit(batch_size)
        rows = q.all()
        if not rows:
            break

        times = [int(r[0]) for r in rows]
        if first_open_time is None:
            first_open_time = times[0]
        last_open_time = times[-1]
        rows_scanned += len(times)

        for t in times:
            if prev_t is not None:
                delta = t - prev_t
                if delta > step:
                    missing = (delta // step) - 1
                    gaps.append((prev_t, t, missing))
            prev_t = t

        cursor_after = times[-1]
        if len(times) < batch_size:
            break

    return gaps, rows_scanned, first_open_time, last_open_time


def _symbol_id(db, symbol: str, asset_type: str) -> int | None:
    row = (
        db.query(Symbol)
        .filter(Symbol.symbol == symbol.upper(), Symbol.asset_type == asset_type)
        .first()
    )
    return row.id if row else None


def _latest_closed_open_time(interval: str) -> int:
    step = _INTERVAL_SECONDS[interval]
    now = int(time.time())
    return (now // step) * step - step


def _current_open_time(interval: str) -> int:
    step = _INTERVAL_SECONDS[interval]
    now = int(time.time())
    return (now // step) * step


async def _latest_open_time_from_api(symbol: str, interval: str, asset_type: str) -> int | None:
    """
    For stocks, wall-clock "latest closed" is not reliable due to market hours.
    Fetch a tiny API tail and derive the latest open_time actually available.
    """
    try:
        api = await fetch_klines_from_api(
            symbol.upper(),
            asset_type,
            interval,
            limit=10,
            end_time=_current_open_time(interval),
        )
    except Exception as e:
        logger.debug("latest-open-time probe failed: %s", e)
        return None
    _, mx = _range_of_open_times(api)
    return mx


def _row_differs_from_api(row: Kline, api: dict[str, Any], eps: float = 1e-12) -> bool:
    return any(
        abs(float(a) - float(b)) > eps
        for a, b in (
            (row.open_price, api["open"]),
            (row.high_price, api["high"]),
            (row.low_price, api["low"]),
            (row.close_price, api["close"]),
            (row.base_volume, api["volume"]),
        )
    )


async def correct_recent_candles(
    symbol: str,
    interval: str,
    asset_type: str,
    correction_limit: int,
    include_current_candle: bool,
    dry_run: bool,
) -> int:
    symbol_u = symbol.upper()
    if asset_type == "stock":
        # Use latest API candle time so we don't "correct" non-trading periods.
        end_t = await _latest_open_time_from_api(symbol_u, interval, asset_type)
        if end_t is None:
            end_t = _current_open_time(interval) if include_current_candle else _latest_closed_open_time(interval)
    else:
        end_t = _current_open_time(interval) if include_current_candle else _latest_closed_open_time(interval)
    if correction_limit <= 0:
        logger.info("Correction skipped: correction_limit <= 0")
        return 0

    db = SessionLocal()
    try:
        sid = _symbol_id(db, symbol_u, asset_type)
        if sid is None and not dry_run:
            upsert_symbol(db, infer_symbol_row(symbol_u, asset_type))
            sid = _symbol_id(db, symbol_u, asset_type)
        if not sid:
            logger.info(
                "Correction skipped: symbol row not found for %s @ %s",
                symbol_u,
                interval,
            )
            return 0

        api = await fetch_klines_from_api(
            symbol_u,
            asset_type,
            interval,
            limit=correction_limit,
            end_time=end_t,
        )
        if not api:
            logger.info("Correction skipped: API returned no candles")
            return 0

        min_t, max_t = _range_of_open_times(api)
        if min_t is None or max_t is None:
            logger.info("Correction skipped: empty API range")
            return 0
        api_times = {int(k["time"]) for k in api}

        rows = (
            db.query(Kline)
            .filter(
                Kline.symbol_id == sid,
                Kline.bar_interval == interval,
                Kline.open_time >= min_t,
                Kline.open_time <= max_t,
            )
            .all()
        )
        by_t = {int(r.open_time): r for r in rows}

        to_save: list[dict[str, Any]] = []
        mismatch_count = 0
        missing_count = 0
        for k in api:
            t = int(k["time"])
            if t > end_t:
                continue
            row = by_t.get(t)
            if row is None:
                missing_count += 1
                to_save.append(k)
                continue
            if _row_differs_from_api(row, k):
                mismatch_count += 1
                to_save.append(k)

        fix_min_t, fix_max_t = _range_of_open_times(to_save)
        corrected = len(to_save) if dry_run else (save_klines(db, sid, interval, to_save) if to_save else 0)

        # Stock cleanup: remove obvious non-trading placeholder candles (volume=0)
        # that exist in DB but do not exist in the API result set.
        if asset_type == "stock":
            step = _INTERVAL_SECONDS.get(interval)
            prune_end = max_t + (step * 2 if step else 0)
            extra = (
                db.query(Kline)
                .filter(
                    Kline.symbol_id == sid,
                    Kline.bar_interval == interval,
                    Kline.open_time >= min_t,
                    Kline.open_time <= prune_end,
                )
                .all()
            )
            prune_ids = [
                int(r.id)
                for r in extra
                if int(r.open_time) not in api_times and float(r.base_volume) <= 0
            ]
            if prune_ids:
                if dry_run:
                    logger.info(
                        "Dry-run stock prune: would_delete=%d rows (volume=0, not in API set)",
                        len(prune_ids),
                    )
                else:
                    db.query(Kline).filter(Kline.id.in_(prune_ids)).delete(synchronize_session=False)
                    db.commit()
                    logger.info(
                        "Stock prune: deleted=%d rows (volume=0, not in API set)",
                        len(prune_ids),
                    )

        logger.info(
            "%s correction plan: symbol=%s asset=%s interval=%s end=%s limit=%d api_checked=%d api_range=[%s -> %s] fix_needed=%d fix_range=[%s -> %s]",
            "Dry-run" if dry_run else "Apply",
            symbol_u,
            asset_type,
            interval,
            _fmt_ts(end_t),
            correction_limit,
            len(api),
            _fmt_ts(min_t),
            _fmt_ts(max_t),
            len(to_save),
            _fmt_ts(fix_min_t),
            _fmt_ts(fix_max_t),
        )
        logger.info(
            "%s correction: range=[%s -> %s] fetched=%d mismatched=%d missing=%d %s=%d include_current=%s",
            "Dry-run" if dry_run else "Apply",
            _fmt_ts(min_t),
            _fmt_ts(max_t),
            len(api),
            mismatch_count,
            missing_count,
            "would_upsert" if dry_run else "upserted",
            corrected,
            include_current_candle,
        )
        return corrected
    finally:
        db.close()


async def seed_from_http(symbol: str, interval: str, limit: int, asset_type: str) -> int:
    symbol = symbol.upper()
    klines = await fetch_klines_from_api(symbol, asset_type, interval, limit)
    if not klines:
        logger.warning("No candles fetched from HTTP API for %s @ %s", symbol, interval)
        return 0

    db = SessionLocal()
    try:
        upsert_symbol(db, infer_symbol_row(symbol, asset_type))
        sid = _symbol_id(db, symbol, asset_type)
        if not sid:
            logger.error("Failed to resolve symbol id for %s", symbol)
            return 0
        inserted = save_klines(db, sid, interval, klines)
        logger.info("HTTP seed done: %s @ %s -> %d candles", symbol, interval, inserted)
        return inserted
    finally:
        db.close()


async def fill_gaps(
    symbol: str,
    interval: str,
    asset_type: str,
    scan_window: int,
    scan_start_time: int | None,
    scan_end_time: int | None,
    fill_tail: bool,
    scan_internal: bool,
    auto_correct: bool,
    correction_limit: int,
    include_current_candle: bool,
    dry_run: bool,
) -> int:
    symbol_u = symbol.upper()
    step = _INTERVAL_SECONDS.get(interval)
    if not step:
        raise ValueError(f"Unsupported interval for gap fill: {interval}")

    db = SessionLocal()
    try:
        sid = _symbol_id(db, symbol_u, asset_type)
        if sid is None and not dry_run:
            upsert_symbol(db, infer_symbol_row(symbol_u, asset_type))
            sid = _symbol_id(db, symbol_u, asset_type)
        if not sid:
            if dry_run:
                logger.info(
                    "Dry-run: symbol %s does not exist in DB yet; will estimate tail fill from API only.",
                    symbol_u,
                )
                open_times = []
                newest = None
            else:
                logger.error("Failed to resolve symbol id for %s", symbol_u)
                return 0
        else:
            newest_row = (
                db.query(Kline.open_time)
                .filter(Kline.symbol_id == sid, Kline.bar_interval == interval)
                .order_by(Kline.open_time.desc())
                .limit(1)
                .all()
            )
            newest = int(newest_row[0][0]) if newest_row else None

        total_saved_or_planned = 0

        # 1) Tail gap: from newest DB candle -> latest closed candle.
        if fill_tail:
            if asset_type == "stock":
                latest_closed = await _latest_open_time_from_api(symbol_u, interval, asset_type)
                if latest_closed is None:
                    latest_closed = _latest_closed_open_time(interval)
            else:
                latest_closed = _latest_closed_open_time(interval)
            if newest is None:
                if dry_run:
                    api = await fetch_klines_from_api(symbol_u, asset_type, interval, 1000)
                    planned = len([k for k in api if int(k["time"]) <= latest_closed])
                    total_saved_or_planned += planned
                    logger.info(
                        "Dry-run tail fill: DB empty/no symbol row; would fetch=%d and save~=%d candles",
                        len(api),
                        planned,
                    )
                else:
                    logger.info("No existing data; filling recent tail using HTTP backfill.")
                    total_saved_or_planned += await seed_from_http(symbol_u, interval, 1000, asset_type)
            elif newest < latest_closed:
                missing_tail = max(0, (latest_closed - newest) // step)
                fetch_limit = min(max(missing_tail + 5, 50), 10_000)
                api = await fetch_klines_from_api(symbol_u, asset_type, interval, fetch_limit)
                to_save = [k for k in api if newest < int(k["time"]) <= latest_closed]
                api_min_t, api_max_t = _range_of_open_times(api)
                fill_min_t, fill_max_t = _range_of_open_times(to_save)
                saved = len(to_save) if dry_run else (save_klines(db, sid, interval, to_save) if to_save else 0)
                total_saved_or_planned += saved
                logger.info(
                    "%s tail gap fill: check=[%s -> %s] missing=%d api_range=[%s -> %s] %s_range=[%s -> %s] fetched=%d %s=%d",
                    "Dry-run" if dry_run else "Apply",
                    newest,
                    latest_closed,
                    missing_tail,
                    _fmt_ts(api_min_t),
                    _fmt_ts(api_max_t),
                    "would_save" if dry_run else "saved",
                    _fmt_ts(fill_min_t),
                    _fmt_ts(fill_max_t),
                    len(api),
                    "would_save" if dry_run else "saved",
                    saved,
                )
            else:
                logger.info("Tail already up to date for %s @ %s", symbol_u, interval)

        # 2) Internal gaps: scan timeline for jumps > 1 interval.
        if scan_internal and sid:
            gaps, scanned_rows, scan_start_t, scan_end_t = _scan_internal_gaps_segmented(
                db,
                sid,
                interval,
                step,
                max(2, scan_window),
                scan_start_time=scan_start_time,
                scan_end_time=scan_end_time,
            )
            if scan_start_t is None:
                logger.info("Internal segmented scan: no rows for %s @ %s", symbol_u, interval)
            else:
                logger.info(
                    "Internal segmented scan: rows=%d batch_size=%d effective_range=[%s -> %s] filter=[%s -> %s]",
                    scanned_rows,
                    max(2, scan_window),
                    _fmt_ts(scan_start_t),
                    _fmt_ts(scan_end_t),
                    _fmt_ts(scan_start_time),
                    _fmt_ts(scan_end_time),
                )

            if gaps:
                logger.info("Internal segmented scan found %d gaps", len(gaps))
            else:
                logger.info("Internal segmented scan found no gaps")

            for left_t, right_t, missing in gaps:
                # Pull exactly this gap span (time-bounded) and keep only candles in this hole.
                fetch_limit = min(max(missing + 20, 100), 10_000)
                miss_start_t, miss_end_t = _missing_span(left_t, right_t, step)
                if miss_start_t is None or miss_end_t is None:
                    logger.info(
                        "%s internal gap: boundary=[%s -> %s] has no valid missing span",
                        "Dry-run" if dry_run else "Apply",
                        _fmt_ts(left_t),
                        _fmt_ts(right_t),
                    )
                    continue
                api = await fetch_klines_from_api(
                    symbol_u,
                    asset_type,
                    interval,
                    fetch_limit,
                    start_time=miss_start_t,
                    end_time=miss_end_t,
                )
                # Stock markets have scheduled closures (overnight/weekends/holidays).
                # If the API returns nothing for a "gap span", skip it instead of trying
                # to force-fill non-trading periods.
                if asset_type == "stock" and not api:
                    logger.info(
                        "Skip internal gap (stock market closed): boundary=[%s -> %s] span=[%s -> %s]",
                        _fmt_ts(left_t),
                        _fmt_ts(right_t),
                        _fmt_ts(miss_start_t),
                        _fmt_ts(miss_end_t),
                    )
                    continue
                to_save = [k for k in api if left_t < int(k["time"]) < right_t]
                # Some stock providers may return candles adjacent to the window even
                # when the in-between span is a non-trading closure. If nothing lands
                # inside the span, treat it as a market-closed gap.
                if asset_type == "stock" and not to_save:
                    logger.info(
                        "Skip internal gap (stock market closed/no in-span candles): boundary=[%s -> %s] span=[%s -> %s] fetched=%d",
                        _fmt_ts(left_t),
                        _fmt_ts(right_t),
                        _fmt_ts(miss_start_t),
                        _fmt_ts(miss_end_t),
                        len(api),
                    )
                    continue
                api_min_t, api_max_t = _range_of_open_times(api)
                fill_min_t, fill_max_t = _range_of_open_times(to_save)
                saved = len(to_save) if dry_run else (save_klines(db, sid, interval, to_save) if to_save else 0)
                total_saved_or_planned += saved
                logger.info(
                    "%s internal gap: boundary=[%s -> %s] missing_span=[%s -> %s] missing=%d api_range=[%s -> %s] %s_range=[%s -> %s] fetched=%d %s=%d",
                    "Dry-run" if dry_run else "Apply",
                    _fmt_ts(left_t),
                    _fmt_ts(right_t),
                    _fmt_ts(miss_start_t),
                    _fmt_ts(miss_end_t),
                    missing,
                    _fmt_ts(api_min_t),
                    _fmt_ts(api_max_t),
                    "would_save" if dry_run else "saved",
                    _fmt_ts(fill_min_t),
                    _fmt_ts(fill_max_t),
                    len(api),
                    "would_save" if dry_run else "saved",
                    saved,
                )
        elif scan_internal and not sid:
            logger.info("Dry-run internal scan skipped: symbol row does not exist in DB.")

        # 3) Auto-correct: compare DB candles with API candles and fix mismatched rows.
        if auto_correct:
            corrected = await correct_recent_candles(
                symbol_u,
                interval,
                asset_type,
                correction_limit=correction_limit,
                include_current_candle=include_current_candle,
                dry_run=dry_run,
            )
            total_saved_or_planned += corrected

        logger.info(
            "Gap fill done (%s): total candles %s=%d",
            "dry-run" if dry_run else "applied",
            "would_save" if dry_run else "saved",
            total_saved_or_planned,
        )
        return total_saved_or_planned
    finally:
        db.close()


def _format_ws_candle(msg: dict[str, Any]) -> dict[str, Any] | None:
    data = msg.get("data", msg)
    k = data.get("k") if isinstance(data, dict) else None
    if not k:
        return None
    # Use only closed candles to avoid writing partial bars.
    if not k.get("x"):
        return None
    return {
        "time": int(k["t"]) // 1000,
        "open": float(k["o"]),
        "high": float(k["h"]),
        "low": float(k["l"]),
        "close": float(k["c"]),
        "volume": float(k["v"]),
    }


async def seed_from_ws(symbol: str, interval: str, sample_size: int, asset_type: str) -> int:
    symbol_u = symbol.upper()
    is_stock = asset_type == "stock"
    if is_stock:
        raise ValueError("WS mode only supports crypto/futures symbols.")

    is_futures = symbol_u.startswith("XAU") or symbol_u.startswith("XAG")
    base = settings.BINANCE_FUTURES_WS_URL if is_futures else settings.BINANCE_WS_URL
    stream = f"{symbol.lower()}@kline_{interval}"
    # Binance combined streams use /stream?streams=...
    # Spot base in env is often .../ws, so normalize to endpoint root first.
    root = base[:-3] if base.endswith("/ws") else base
    if root.endswith("/stream"):
        url = f"{root}?streams={stream}"
    else:
        url = f"{root}/stream?streams={stream}"

    collected: list[dict[str, Any]] = []
    logger.info("Connecting WS: %s", url)

    async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
        while len(collected) < sample_size:
            raw = await ws.recv()
            msg = json.loads(raw)
            candle = _format_ws_candle(msg)
            if candle:
                collected.append(candle)
                logger.info(
                    "WS collected %d/%d closed candles (t=%s)",
                    len(collected),
                    sample_size,
                    candle["time"],
                )

    db = SessionLocal()
    try:
        upsert_symbol(db, infer_symbol_row(symbol_u, asset_type))
        sid = _symbol_id(db, symbol_u, asset_type)
        if not sid:
            logger.error("Failed to resolve symbol id for %s", symbol_u)
            return 0
        inserted = save_klines(db, sid, interval, collected)
        logger.info("WS seed done: %s @ %s -> %d candles", symbol_u, interval, inserted)
        return inserted
    finally:
        db.close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed kline/candle data into DB")
    parser.add_argument("--mode", choices=["http", "ws", "fill-gaps", "correct"], default="http")
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--asset-type", choices=["crypto", "stock"], default="crypto")
    parser.add_argument("--limit", type=int, default=1000, help="HTTP fetch size")
    parser.add_argument(
        "--sample-size",
        type=int,
        default=5,
        help="WS mode: number of closed candles to collect before persisting",
    )
    parser.add_argument(
        "--scan-window",
        type=int,
        default=5000,
        help="fill-gaps mode: internal scan segment size (rows per DB batch, full-history scan)",
    )
    parser.add_argument(
        "--scan-start-time",
        type=str,
        default=None,
        help=(
            "fill-gaps mode: optional internal scan start time, format yyyymmddHHmmss (UTC); "
            "if omitted, uses earliest DB candle time"
        ),
    )
    parser.add_argument(
        "--scan-end-time",
        type=str,
        default=None,
        help=(
            "fill-gaps mode: optional internal scan end time, format yyyymmddHHmmss (UTC); "
            "if omitted, uses latest DB candle time"
        ),
    )
    parser.add_argument(
        "--no-tail",
        action="store_true",
        help="fill-gaps mode: disable tail-gap filling",
    )
    parser.add_argument(
        "--no-internal",
        action="store_true",
        help="fill-gaps mode: disable internal-gap scan/fill",
    )
    parser.add_argument(
        "--auto-correct",
        action="store_true",
        help="fill-gaps mode: auto-correct mismatched candles by comparing DB rows with API candles",
    )
    parser.add_argument(
        "--correction-limit",
        type=int,
        default=1000,
        help="fill-gaps mode: number of most recent candles to verify/correct from API",
    )
    parser.add_argument(
        "--include-current-candle",
        action="store_true",
        help="correct/fill-gaps mode: include currently open candle for correction",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="fill-gaps mode: plan and print gaps without writing to DB",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    scan_start_time = _parse_human_ts(args.scan_start_time) if args.scan_start_time else None
    scan_end_time = _parse_human_ts(args.scan_end_time) if args.scan_end_time else None
    if scan_start_time is not None and scan_end_time is not None and scan_start_time > scan_end_time:
        raise ValueError("--scan-start-time must be <= --scan-end-time")
    logger.info(
        "Internal scan filter resolved: start=%s end=%s (missing start=>earliest DB, missing end=>latest DB)",
        _fmt_ts(scan_start_time),
        _fmt_ts(scan_end_time),
    )

    try:
        if args.mode == "http":
            await seed_from_http(args.symbol, args.interval, args.limit, args.asset_type)
            return
        if args.mode == "ws":
            await seed_from_ws(args.symbol, args.interval, args.sample_size, args.asset_type)
            return
        if args.mode == "correct":
            await correct_recent_candles(
                args.symbol,
                args.interval,
                args.asset_type,
                correction_limit=args.correction_limit,
                include_current_candle=args.include_current_candle,
                dry_run=args.dry_run,
            )
            return
        await fill_gaps(
            args.symbol,
            args.interval,
            args.asset_type,
            scan_window=args.scan_window,
            scan_start_time=scan_start_time,
            scan_end_time=scan_end_time,
            fill_tail=not args.no_tail,
            scan_internal=not args.no_internal,
            auto_correct=args.auto_correct,
            correction_limit=args.correction_limit,
            include_current_candle=args.include_current_candle,
            dry_run=args.dry_run,
        )
    except OperationalError as e:
        logger.error("Database connection failed: %s", e)
        logger.error(
            "Current DB target is %s:%s/%s. If running script on host Linux, "
            "set DB_HOST=localhost (or your DB IP) instead of host.docker.internal.",
            settings.DB_HOST,
            settings.DB_PORT,
            settings.DB_NAME,
        )
        raise SystemExit(2) from e


if __name__ == "__main__":
    asyncio.run(main())
