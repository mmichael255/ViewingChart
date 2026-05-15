"""
Background scheduler that periodically fetches klines for all symbols in the
superadmin's watchlists and persists them to MariaDB.

Main intervals (1m, 15m, 1h, 4h, 1d) are fetched directly from APIs.
Derived intervals (3m, 5m, 30m, 1w, 1M) are aggregated from stored data.

Two-tier cycle:
  - Fast cycle (every CYCLE_INTERVAL_SECONDS, default 15min): tail-fill + aggregation
  - Deep cycle (every DEEP_CYCLE_INTERVAL_SECONDS, default 24h): full-history backfill
    for new symbols, early-gap backfill, internal gap scan, and auto-correct.
"""

import asyncio
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from logging.handlers import TimedRotatingFileHandler
from typing import Any

from app.database.connection import SessionLocal
from app.database.models import Symbol, Kline, User, Watchlist, WatchlistItem
from app.services.klines_db_service import (
    fetch_klines_from_api,
    save_klines,
    load_klines_from_db,
    upsert_symbol,
    infer_symbol_row,
    _bar_interval_seconds,
    _to_unix_seconds,
    use_stock_kline_api,
)

logger = logging.getLogger(__name__)

# ── File output with daily rotation ─────────────────────────────────────
_log_path = os.getenv("KLINE_SCHEDULER_LOG_PATH", "logs/scheduler.log")
_log_dir = os.path.dirname(_log_path)
if _log_dir:
    os.makedirs(_log_dir, exist_ok=True)
_file_handler = TimedRotatingFileHandler(
    _log_path, when="midnight", interval=1, backupCount=30,
)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s │ %(levelname)-7s │ %(name)-30s │ %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))
logger.addHandler(_file_handler)

# ── Intervals fetched from API ────────────────────────────────────────────
MAIN_INTERVALS = ("1m", "15m", "1h", "4h", "1d")

# Derived interval → (source_interval, factor | "calendar_month")
DERIVED_MAP: dict[str, tuple[str, int | str]] = {
    "3m": ("1m", 3),
    "5m": ("1m", 5),
    "30m": ("15m", 2),
    "1w": ("1d", 7),
    "1M": ("1d", "calendar_month"),
}

# Binance-style intervals → seconds (same as klines_db_service).
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


class RateLimiter:
    """Sliding-window per-minute call cap for a single async consumer."""

    def __init__(self, max_calls_per_minute: int, name: str = "rate_limiter") -> None:
        self.max_calls = max_calls_per_minute
        self.name = name
        self._timestamps: deque[float] = deque()

    async def acquire(self) -> None:
        now = time.monotonic()
        while self._timestamps and self._timestamps[0] < now - 60.0:
            self._timestamps.popleft()
        if len(self._timestamps) >= self.max_calls:
            wait = self._timestamps[0] + 60.0 - now + 0.1
            if wait > 0:
                logger.debug(
                    "RateLimiter[%s]: waiting %.1fs (%d/%d used)",
                    self.name, wait, len(self._timestamps), self.max_calls,
                )
                await asyncio.sleep(wait)
                return await self.acquire()
        self._timestamps.append(time.monotonic())


class KlineScheduler:
    """Periodically fetches & persists klines for superadmin watchlist symbols."""

    CYCLE_INTERVAL_SECONDS = int(os.getenv("KLINE_SCHEDULER_CYCLE_S", "900"))  # 15 min
    DEEP_CYCLE_INTERVAL_SECONDS = int(os.getenv("KLINE_SCHEDULER_DEEP_CYCLE_S", "86400"))  # 24h
    TAIL_FETCH_LIMIT = int(os.getenv("KLINE_SCHEDULER_TAIL_LIMIT", "100"))
    BACKFILL_LIMIT_1M = int(os.getenv("KLINE_SCHEDULER_BACKFILL_LIMIT_1M", "1000000"))
    BACKFILL_LIMIT = int(os.getenv("KLINE_SCHEDULER_BACKFILL_LIMIT", "200000"))
    SCAN_WINDOW = int(os.getenv("KLINE_SCHEDULER_SCAN_WINDOW", "5000"))
    CORRECTION_LIMIT = int(os.getenv("KLINE_SCHEDULER_CORRECTION_LIMIT", "200"))
    BINANCE_RATE_LIMIT = int(os.getenv("KLINE_SCHEDULER_BINANCE_RPM", "600"))
    YFINANCE_RATE_LIMIT = int(os.getenv("KLINE_SCHEDULER_YFINANCE_RPM", "20"))

    def __init__(self) -> None:
        self.running = False
        self._binance_limiter = RateLimiter(self.BINANCE_RATE_LIMIT, "binance")
        self._yfinance_limiter = RateLimiter(self.YFINANCE_RATE_LIMIT, "yfinance")
        self._last_deep_cycle_time: float = 0.0

    # ── Main loop ─────────────────────────────────────────────────────────

    async def run(self) -> None:
        self.running = True
        logger.info(
            "KlineScheduler started (cycle=%ds, deep_cycle=%ds, "
            "binance_rpm=%d, yfinance_rpm=%d)",
            self.CYCLE_INTERVAL_SECONDS,
            self.DEEP_CYCLE_INTERVAL_SECONDS,
            self.BINANCE_RATE_LIMIT,
            self.YFINANCE_RATE_LIMIT,
        )

        while self.running:
            cycle_start = time.monotonic()
            now_ts = time.time()
            is_deep = (
                self.DEEP_CYCLE_INTERVAL_SECONDS > 0
                and (now_ts - self._last_deep_cycle_time) >= self.DEEP_CYCLE_INTERVAL_SECONDS
            )

            try:
                symbols = self._load_superadmin_symbols_sync()
                if not symbols:
                    logger.info(
                        "KlineScheduler: no superadmin watchlist symbols, sleeping…"
                    )
                else:
                    logger.info(
                        "KlineScheduler %s cycle: %d symbols",
                        "DEEP" if is_deep else "fast", len(symbols),
                    )
                    await self._process_fast_cycle(symbols)
                    if is_deep:
                        logger.info("KlineScheduler: starting deep cycle work…")
                        await self._process_deep_cycle(symbols)
                        self._last_deep_cycle_time = time.time()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("KlineScheduler cycle failed")

            elapsed = time.monotonic() - cycle_start
            sleep_for = max(0.0, self.CYCLE_INTERVAL_SECONDS - elapsed)
            logger.info(
                "KlineScheduler cycle finished in %.1fs (sleeping %.1fs)",
                elapsed, sleep_for,
            )
            try:
                await asyncio.sleep(sleep_for)
            except asyncio.CancelledError:
                break

        logger.info("KlineScheduler stopped")

    # ── Symbol discovery ──────────────────────────────────────────────────

    def _load_superadmin_symbols_sync(self) -> list[dict[str, str]]:
        """Return distinct (symbol, asset_type) pairs from all superadmin watchlists."""
        db = SessionLocal()
        try:
            admin = (
                db.query(User)
                .filter(User.role == "superadmin", User.is_active == True)
                .first()
            )
            if not admin:
                logger.warning("KlineScheduler: no active superadmin user found")
                return []

            wl_ids = [
                r[0]
                for r in db.query(Watchlist.id)
                .filter(Watchlist.user_id == admin.id)
                .all()
            ]
            if not wl_ids:
                logger.info("KlineScheduler: superadmin has no watchlists")
                return []

            rows = (
                db.query(WatchlistItem.symbol, WatchlistItem.asset_type)
                .filter(WatchlistItem.watchlist_id.in_(wl_ids))
                .distinct()
                .all()
            )
            result: list[dict[str, str]] = []
            seen: set[tuple[str, str]] = set()
            for r in rows:
                at = (
                    r.asset_type.value
                    if hasattr(r.asset_type, "value")
                    else r.asset_type
                )
                key = (r.symbol, at)
                if key not in seen:
                    seen.add(key)
                    result.append({"symbol": r.symbol, "asset_type": at})
            return result
        finally:
            db.close()

    # ── Fast cycle ────────────────────────────────────────────────────────

    async def _process_fast_cycle(self, symbols: list[dict[str, str]]) -> None:
        """Tail-fill main intervals, then aggregate derived intervals."""
        for entry in symbols:
            symbol = entry["symbol"]
            asset_type = entry["asset_type"]
            logger.info(
                "KlineScheduler: fast cycle %s %s — start", symbol, asset_type,
            )
            try:
                for interval in MAIN_INTERVALS:
                    await self._tail_fill(symbol, interval, asset_type)

                for target_interval, (src_interval, factor) in DERIVED_MAP.items():
                    await self._aggregate_derived(
                        symbol, src_interval, factor, target_interval, asset_type,
                    )
            except Exception:
                logger.exception(
                    "KlineScheduler: failed symbol %s (%s)", symbol, asset_type,
                )
            logger.info(
                "KlineScheduler: fast cycle %s %s — done", symbol, asset_type,
            )

    # ── Deep cycle ────────────────────────────────────────────────────────

    async def _process_deep_cycle(self, symbols: list[dict[str, str]]) -> None:
        """Full-history backfill for new symbols, early-gap backfill, internal
        gap scan, and auto-correct."""
        for entry in symbols:
            symbol = entry["symbol"]
            asset_type = entry["asset_type"]
            logger.info(
                "KlineScheduler: deep cycle %s %s — start", symbol, asset_type,
            )
            try:
                for interval in MAIN_INTERVALS:
                    if self._is_alphavantage(symbol, asset_type):
                        continue

                    # Full backfill if DB still empty (newly added symbol).
                    step = _bar_interval_seconds(interval)
                    if not step:
                        continue
                    newest, earliest = self._query_db_range(
                        symbol, asset_type, interval,
                    )
                    if newest is None:
                        await self._full_backfill(symbol, interval, asset_type)
                        continue

                    # Early-gap backfill: walk backwards from earliest DB candle.
                    # Only for crypto (Binance supports end_time-bounded queries).
                    if asset_type != "stock":
                        await self._backfill_early_gap(
                            symbol, interval, asset_type, step, earliest,
                        )

                # Internal gap scan (crypto only).
                if asset_type != "stock":
                    for interval in MAIN_INTERVALS:
                        await self._scan_and_fill_internal_gaps(
                            symbol, interval, asset_type,
                        )

                # Auto-correct recent candles.
                for interval in MAIN_INTERVALS:
                    await self._auto_correct(symbol, interval, asset_type)

            except Exception:
                logger.exception(
                    "KlineScheduler: deep cycle failed for %s (%s)",
                    symbol, asset_type,
                )
            logger.info(
                "KlineScheduler: deep cycle %s %s — done", symbol, asset_type,
            )

    # ── Tail fill (fast cycle) ────────────────────────────────────────────

    async def _tail_fill(
        self, symbol: str, interval: str, asset_type: str,
    ) -> None:
        """Fetch and persist only the missing candles between newest DB and now."""
        step = _bar_interval_seconds(interval)
        if not step:
            return

        if self._is_alphavantage(symbol, asset_type):
            return

        newest_db_t, _ = self._query_db_range(symbol, asset_type, interval)

        now = int(time.time())
        latest_closed = (now // step) * step - step

        if newest_db_t is None:
            # DB empty — full backfill (handled in deep cycle, but do a quick
            # tail fill here so the fast cycle has data to work with).
            logger.info(
                "KlineScheduler: quick tail fill %s %s @ %s (DB empty)",
                symbol, asset_type, interval,
            )
            await self._throttle(symbol, asset_type)
            klines = await fetch_klines_from_api(
                symbol, asset_type, interval, limit=self.TAIL_FETCH_LIMIT,
            )
        elif newest_db_t < latest_closed:
            missing = (latest_closed - newest_db_t) // step
            fetch_n = min(
                max(missing + 10, self.TAIL_FETCH_LIMIT // 2),
                self.TAIL_FETCH_LIMIT,
            )
            logger.info(
                "KlineScheduler: tail fill %s %s @ %s (gap=%d bars, fetch=%d)",
                symbol, asset_type, interval, missing, fetch_n,
            )
            await self._throttle(symbol, asset_type)

            if use_stock_kline_api(symbol, asset_type):
                klines = await fetch_klines_from_api(
                    symbol, asset_type, interval, limit=fetch_n,
                )
                klines = [
                    k for k in klines
                    if _to_unix_seconds(k["time"]) > newest_db_t
                ]
            else:
                klines = await fetch_klines_from_api(
                    symbol, asset_type, interval, limit=fetch_n,
                    start_time=newest_db_t + step,
                    end_time=latest_closed + step,
                )
        else:
            logger.info(
                "KlineScheduler: tail fill %s %s @ %s — no gap, DB is current",
                symbol, asset_type, interval,
            )
            return

        if not klines:
            logger.info(
                "KlineScheduler: tail fill %s %s @ %s — API returned 0 klines",
                symbol, asset_type, interval,
            )
            return

        self._persist_klines(symbol, asset_type, interval, klines)

    # ── Full-history backfill (deep cycle, empty DB) ──────────────────────

    async def _full_backfill(
        self, symbol: str, interval: str, asset_type: str,
    ) -> None:
        """Walk backwards through all available API data to fill an empty DB."""
        backfill_limit = (
            self.BACKFILL_LIMIT_1M if interval == "1m" else self.BACKFILL_LIMIT
        )
        logger.info(
            "KlineScheduler: full backfill %s %s @ %s (limit=%d)",
            symbol, asset_type, interval, backfill_limit,
        )
        await self._throttle(symbol, asset_type)
        klines = await fetch_klines_from_api(
            symbol, asset_type, interval, limit=backfill_limit,
        )
        if klines:
            self._persist_klines(symbol, asset_type, interval, klines)
        else:
            logger.info(
                "KlineScheduler: full backfill %s %s @ %s — API returned 0 klines",
                symbol, asset_type, interval,
            )

    # ── Early-gap backfill (deep cycle, crypto only) ──────────────────────

    async def _backfill_early_gap(
        self, symbol: str, interval: str, asset_type: str,
        step: int, earliest_db_t: int | None,
    ) -> None:
        """Walk backwards from the earliest DB candle to fill pre-DB history.

        Only for crypto (Binance supports end_time-bounded queries).
        Walks in chunks of 1000 until the API returns empty (beginning of data).
        """
        if earliest_db_t is None:
            return

        cursor_end = earliest_db_t - step
        total_fetched = 0
        max_early = self.BACKFILL_LIMIT  # cap to avoid infinite loops

        while cursor_end > 0 and total_fetched < max_early:
            logger.info(
                "KlineScheduler: early backfill %s %s @ %s (end_time=%d)",
                symbol, asset_type, interval, cursor_end,
            )
            await self._throttle(symbol, asset_type)
            klines = await fetch_klines_from_api(
                symbol, asset_type, interval,
                limit=1000, end_time=cursor_end,
            )
            if not klines:
                logger.info(
                    "KlineScheduler: early backfill %s %s @ %s — reached beginning of data",
                    symbol, asset_type, interval,
                )
                break

            self._persist_klines(symbol, asset_type, interval, klines)
            total_fetched += len(klines)

            # Move cursor to before the oldest candle in this batch.
            times = [int(k["time"]) for k in klines]
            cursor_end = min(times) - step

        logger.info(
            "KlineScheduler: early backfill complete %s %s @ %s (saved=%d)",
            symbol, asset_type, interval, total_fetched,
        )

    # ── Internal gap scan (deep cycle, crypto only) ───────────────────────

    async def _scan_and_fill_internal_gaps(
        self, symbol: str, interval: str, asset_type: str,
    ) -> None:
        """Scan DB for missing sequences and fill them via time-bounded API fetches.

        Reuses the segmented scan algorithm from seed_candles.py.
        Only for crypto (Binance supports start_time/end_time).
        """
        step = _bar_interval_seconds(interval)
        if not step:
            return

        db = SessionLocal()
        try:
            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if not sym:
                return
            sym_id = sym.id
        finally:
            db.close()

        # Segmented scan for gaps.
        gaps = self._scan_gaps_sync(sym_id, interval, step)
        if not gaps:
            logger.info(
                "KlineScheduler: internal gap scan %s %s @ %s — no gaps found",
                symbol, asset_type, interval,
            )
            return

        logger.info(
            "KlineScheduler: internal gap scan %s %s @ %s: %d gap(s)",
            symbol, asset_type, interval, len(gaps),
        )

        for left_t, right_t, missing in gaps:
            miss_start = left_t + step
            miss_end = right_t - step
            if miss_start > miss_end:
                continue

            fetch_n = min(max(missing + 20, 100), 10_000)
            logger.info(
                "KlineScheduler: filling gap %s %s @ %s "
                "(%d bars missing, span=%d..%d, fetch=%d)",
                symbol, asset_type, interval, missing, miss_start, miss_end, fetch_n,
            )
            await self._throttle(symbol, asset_type)
            klines = await fetch_klines_from_api(
                symbol, asset_type, interval, limit=fetch_n,
                start_time=miss_start, end_time=miss_end,
            )
            if klines:
                self._persist_klines(symbol, asset_type, interval, klines)

    def _scan_gaps_sync(
        self, symbol_id: int, interval: str, step: int,
    ) -> list[tuple[int, int, int]]:
        """Segmented DB scan for gaps in ascending open_time order.

        Returns list of (left_open_time, right_open_time, missing_count).
        """
        gaps: list[tuple[int, int, int]] = []
        db = SessionLocal()
        try:
            cursor_after: int | None = None
            while True:
                q = (
                    db.query(Kline.open_time)
                    .filter(
                        Kline.symbol_id == symbol_id,
                        Kline.bar_interval == interval,
                    )
                    .order_by(Kline.open_time.asc())
                )
                if cursor_after is not None:
                    q = q.filter(Kline.open_time > cursor_after)
                q = q.limit(self.SCAN_WINDOW)
                rows = q.all()
                if not rows:
                    break

                times = [int(r[0]) for r in rows]
                prev_t = times[0]
                for t in times[1:]:
                    delta = t - prev_t
                    if delta > step:
                        missing = (delta // step) - 1
                        gaps.append((prev_t, t, missing))
                    prev_t = t

                cursor_after = times[-1]
                if len(times) < self.SCAN_WINDOW:
                    break
        finally:
            db.close()
        return gaps

    # ── Auto-correct (deep cycle) ─────────────────────────────────────────

    async def _auto_correct(
        self, symbol: str, interval: str, asset_type: str,
    ) -> None:
        """Compare recent DB candles against API and fix mismatches.

        Reuses the algorithm from seed_candles.py correct_recent_candles().
        """
        step = _bar_interval_seconds(interval)
        if not step:
            return

        if self.CORRECTION_LIMIT <= 0:
            return

        # Determine end time.
        now = int(time.time())
        if asset_type == "stock":
            end_t = now  # stock auto-correct uses wall-clock; seed_candles probes API
        else:
            end_t = (now // step) * step - step  # latest closed

        await self._throttle(symbol, asset_type)
        api = await fetch_klines_from_api(
            symbol, asset_type, interval,
            limit=self.CORRECTION_LIMIT, end_time=end_t,
        )
        if not api:
            logger.info(
                "KlineScheduler: auto-correct %s %s @ %s — API returned 0 klines",
                symbol, asset_type, interval,
            )
            return

        min_t = min(int(k["time"]) for k in api)
        max_t = max(int(k["time"]) for k in api)
        api_times = {int(k["time"]) for k in api}

        db = SessionLocal()
        try:
            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if not sym:
                return
            sid = sym.id

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
            for k in api:
                t = int(k["time"])
                if t > end_t:
                    continue
                row = by_t.get(t)
                if row is None:
                    to_save.append(k)
                elif self._row_differs(row, k):
                    to_save.append(k)

            if to_save:
                saved = save_klines(db, sid, interval, to_save)
                logger.info(
                    "KlineScheduler: corrected %d candles for %s %s @ %s",
                    saved, symbol, asset_type, interval,
                )
            else:
                logger.info(
                    "KlineScheduler: auto-correct %s %s @ %s — no corrections needed",
                    symbol, asset_type, interval,
                )

            # Stock cleanup: prune zero-volume rows not in API set.
            if asset_type == "stock" and to_save:
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
                    int(r.id) for r in extra
                    if int(r.open_time) not in api_times and float(r.base_volume) <= 0
                ]
                if prune_ids:
                    db.query(Kline).filter(Kline.id.in_(prune_ids)).delete(
                        synchronize_session=False,
                    )
                    db.commit()
                    logger.info(
                        "KlineScheduler: stock prune %s %s @ %s: deleted=%d",
                        symbol, asset_type, interval, len(prune_ids),
                    )
        finally:
            db.close()

    @staticmethod
    def _row_differs(row: Kline, api: dict[str, Any], eps: float = 1e-12) -> bool:
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

    # ── Aggregation ───────────────────────────────────────────────────────

    async def _aggregate_derived(
        self,
        symbol: str,
        source_interval: str,
        factor: int | str,
        target_interval: str,
        asset_type: str,
    ) -> None:
        db = SessionLocal()
        try:
            source_bars = load_klines_from_db(
                db, symbol, asset_type, source_interval, limit=2000,
            )
            if not source_bars:
                logger.info(
                    "KlineScheduler: derived %s %s %s → %s — no source bars, skipping",
                    symbol, asset_type, source_interval, target_interval,
                )
                return

            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if not sym:
                return
            newest_derived_row = (
                db.query(Kline.open_time)
                .filter(
                    Kline.symbol_id == sym.id,
                    Kline.bar_interval == target_interval,
                )
                .order_by(Kline.open_time.desc())
                .first()
            )
            newest_derived_t = (
                int(newest_derived_row[0]) if newest_derived_row else 0
            )
        finally:
            db.close()

        if factor == "calendar_month":
            derived_bars = self._aggregate_calendar_month(source_bars)
        else:
            derived_bars = self._aggregate_fixed(source_bars, int(factor))

        new_bars = [b for b in derived_bars if b["time"] > newest_derived_t]
        if not new_bars:
            logger.info(
                "KlineScheduler: derived %s %s %s → %s — already current, no new bars",
                symbol, asset_type, source_interval, target_interval,
            )
            return

        logger.info(
            "KlineScheduler: derived %s %s %s → %s: %d new bars",
            symbol, asset_type, source_interval, target_interval, len(new_bars),
        )

        db = SessionLocal()
        try:
            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if sym:
                save_klines(db, sym.id, target_interval, new_bars)
        finally:
            db.close()

    @staticmethod
    def _aggregate_fixed(candles: list[dict], factor: int) -> list[dict[str, Any]]:
        """Group every `factor` consecutive candles into one OHLCV bar."""
        if factor <= 1 or not candles:
            return candles
        result: list[dict[str, Any]] = []
        for i in range(0, len(candles), factor):
            group = candles[i : i + factor]
            if len(group) < factor:
                continue
            result.append({
                "time": group[0]["time"],
                "open": group[0]["open"],
                "high": max(c["high"] for c in group),
                "low": min(c["low"] for c in group),
                "close": group[-1]["close"],
                "volume": sum(c["volume"] for c in group),
            })
        return result

    @staticmethod
    def _aggregate_calendar_month(
        candles: list[dict],
    ) -> list[dict[str, Any]]:
        """Group 1d bars by UTC (year, month) into 1M OHLCV bars."""
        groups: dict[tuple[int, int], list[dict]] = {}
        for c in candles:
            dt = datetime.fromtimestamp(c["time"], tz=timezone.utc)
            key = (dt.year, dt.month)
            groups.setdefault(key, []).append(c)

        result: list[dict[str, Any]] = []
        for key in sorted(groups.keys()):
            group = groups[key]
            result.append({
                "time": group[0]["time"],
                "open": group[0]["open"],
                "high": max(c["high"] for c in group),
                "low": min(c["low"] for c in group),
                "close": group[-1]["close"],
                "volume": sum(c["volume"] for c in group),
            })
        return result

    # ── DB helpers ────────────────────────────────────────────────────────

    def _query_db_range(
        self, symbol: str, asset_type: str, interval: str,
    ) -> tuple[int | None, int | None]:
        """Return (newest_open_time, earliest_open_time) for a symbol+interval."""
        db = SessionLocal()
        try:
            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if not sym:
                return None, None

            newest = (
                db.query(Kline.open_time)
                .filter(Kline.symbol_id == sym.id, Kline.bar_interval == interval)
                .order_by(Kline.open_time.desc())
                .first()
            )
            earliest = (
                db.query(Kline.open_time)
                .filter(Kline.symbol_id == sym.id, Kline.bar_interval == interval)
                .order_by(Kline.open_time.asc())
                .first()
            )
            return (
                int(newest[0]) if newest else None,
                int(earliest[0]) if earliest else None,
            )
        finally:
            db.close()

    def _persist_klines(
        self, symbol: str, asset_type: str, interval: str,
        klines: list[dict],
    ) -> None:
        """Upsert klines and log result."""
        db = SessionLocal()
        try:
            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if sym:
                saved = save_klines(db, sym.id, interval, klines)
                logger.info(
                    "KlineScheduler: saved %d candles for %s %s @ %s",
                    saved, symbol, asset_type, interval,
                )
        except Exception:
            logger.exception(
                "KlineScheduler: persist failed for %s %s @ %s",
                symbol, asset_type, interval,
            )
        finally:
            db.close()

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _throttle(self, symbol: str, asset_type: str) -> None:
        if use_stock_kline_api(symbol, asset_type):
            await self._yfinance_limiter.acquire()
        else:
            await self._binance_limiter.acquire()

    @staticmethod
    def _is_alphavantage(symbol: str, asset_type: str) -> bool:
        """True if this symbol would be routed to Alpha Vantage (unusable for bulk)."""
        if asset_type != "stock":
            return False
        if symbol.endswith("=X") or "/" in symbol:
            return True
        if symbol.upper().startswith(("XAU", "XAG", "XPT", "XPD")):
            return True
        return False


# ── Module-level singleton ────────────────────────────────────────────────
kline_scheduler = KlineScheduler()