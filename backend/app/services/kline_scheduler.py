"""
Background scheduler that periodically fetches klines for all symbols in the
superadmin's watchlists and persists them to MariaDB.

Main intervals (1m, 15m, 1h, 4h, 1d) are fetched directly from APIs.
Derived intervals (3m, 5m, 30m, 1w, 1M) are aggregated from stored data.
"""

import asyncio
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
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


class RateLimiter:
    """Sliding-window per-minute call cap for a single async consumer."""

    def __init__(self, max_calls_per_minute: int, name: str = "rate_limiter") -> None:
        self.max_calls = max_calls_per_minute
        self.name = name
        self._timestamps: deque[float] = deque()

    async def acquire(self) -> None:
        now = time.monotonic()
        # Evict timestamps outside the 60 s window.
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
                # Re-check after sleep (more tokens may have freed).
                return await self.acquire()
        self._timestamps.append(time.monotonic())


class KlineScheduler:
    """Periodically fetches & persists klines for superadmin watchlist symbols."""

    CYCLE_INTERVAL_SECONDS = int(
        os.getenv("KLINE_SCHEDULER_CYCLE_S", "900")
    )  # 15 min
    INITIAL_BACKFILL_LIMIT = int(
        os.getenv("KLINE_SCHEDULER_BACKFILL_LIMIT", "1000")
    )
    TAIL_FETCH_LIMIT = int(os.getenv("KLINE_SCHEDULER_TAIL_LIMIT", "100"))
    BINANCE_RATE_LIMIT = int(
        os.getenv("KLINE_SCHEDULER_BINANCE_RPM", "600")
    )
    YFINANCE_RATE_LIMIT = int(
        os.getenv("KLINE_SCHEDULER_YFINANCE_RPM", "20")
    )

    def __init__(self) -> None:
        self.running = False
        self._binance_limiter = RateLimiter(self.BINANCE_RATE_LIMIT, "binance")
        self._yfinance_limiter = RateLimiter(self.YFINANCE_RATE_LIMIT, "yfinance")

    # ── Main loop ─────────────────────────────────────────────────────────

    async def run(self) -> None:
        self.running = True
        logger.info(
            "KlineScheduler started (cycle=%ds, binance_rpm=%d, yfinance_rpm=%d)",
            self.CYCLE_INTERVAL_SECONDS,
            self.BINANCE_RATE_LIMIT,
            self.YFINANCE_RATE_LIMIT,
        )

        while self.running:
            cycle_start = time.monotonic()
            try:
                symbols = self._load_superadmin_symbols_sync()
                if not symbols:
                    logger.info(
                        "KlineScheduler: no superadmin watchlist symbols, sleeping…"
                    )
                else:
                    logger.info(
                        "KlineScheduler cycle: %d symbols", len(symbols)
                    )
                    await self._process_all_symbols(symbols)
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
            # asset_type is a Python enum in the ORM; extract its .value.
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

    # ── Per-cycle processing ──────────────────────────────────────────────

    async def _process_all_symbols(self, symbols: list[dict[str, str]]) -> None:
        for entry in symbols:
            symbol = entry["symbol"]
            asset_type = entry["asset_type"]
            try:
                for interval in MAIN_INTERVALS:
                    await self._fetch_main_interval(symbol, interval, asset_type)

                for target_interval, (src_interval, factor) in DERIVED_MAP.items():
                    await self._aggregate_derived(
                        symbol, src_interval, factor, target_interval, asset_type,
                    )
            except Exception:
                logger.exception(
                    "KlineScheduler: failed symbol %s (%s)", symbol, asset_type,
                )

    # ── API fetch + persist ───────────────────────────────────────────────

    async def _fetch_main_interval(
        self, symbol: str, interval: str, asset_type: str,
    ) -> None:
        step = _bar_interval_seconds(interval)
        if not step:
            return

        # Skip Alpha Vantage symbols — 25 req/day is too low for bulk backfill.
        if self._is_alphavantage(symbol, asset_type):
            logger.debug(
                "KlineScheduler: skipping Alpha Vantage symbol %s (%s)",
                symbol, asset_type,
            )
            return

        # Check the newest candle already in DB.
        db = SessionLocal()
        try:
            upsert_symbol(db, infer_symbol_row(symbol, asset_type))
            sym = db.query(Symbol).filter(
                Symbol.symbol == symbol, Symbol.asset_type == asset_type,
            ).first()
            if not sym:
                return
            sym_id = sym.id
            newest_row = (
                db.query(Kline.open_time)
                .filter(
                    Kline.symbol_id == sym_id,
                    Kline.bar_interval == interval,
                )
                .order_by(Kline.open_time.desc())
                .first()
            )
            newest_db_t = int(newest_row[0]) if newest_row else None
        finally:
            db.close()

        now = int(time.time())
        latest_closed = (now // step) * step - step  # last fully-closed bar's open_time

        if newest_db_t is None:
            # Full backfill — first time seeing this symbol + interval.
            logger.info(
                "KlineScheduler: full backfill %s %s @ %s",
                symbol, asset_type, interval,
            )
            await self._throttle(symbol, asset_type)
            klines = await fetch_klines_from_api(
                symbol, asset_type, interval,
                limit=self.INITIAL_BACKFILL_LIMIT,
            )
        elif newest_db_t < latest_closed:
            # Tail fill — only fetch missing bars.
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
                # yfinance has no start_time/end_time — fetch latest N and
                # filter to only bars newer than what's in DB.
                klines = await fetch_klines_from_api(
                    symbol, asset_type, interval, limit=fetch_n,
                )
                klines = [
                    k for k in klines
                    if _to_unix_seconds(k["time"]) > newest_db_t
                ]
            else:
                # Binance supports time-bounded fetch for precise gap fill.
                klines = await fetch_klines_from_api(
                    symbol, asset_type, interval, limit=fetch_n,
                    start_time=newest_db_t + step,
                    end_time=latest_closed + step,
                )
        else:
            return  # up to date

        if not klines:
            return

        # Persist.
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
                continue  # incomplete final group — skip
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
