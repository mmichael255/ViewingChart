"""Macro indicator endpoints: DXY, Treasury yields, Fed Funds rate, economic data."""

import logging
from fastapi import APIRouter, Query

from app.services.macro_service import macro_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/macro", tags=["macro"])


@router.get("/dashboard")
async def macro_dashboard():
    """Full macro snapshot: DXY, yields, Fed rate, spreads."""
    return await macro_service.get_dashboard()


@router.get("/dxy")
async def macro_dxy():
    """US Dollar Index snapshot (FRED primary, yfinance fallback)."""
    return await macro_service.get_dxy()


@router.get("/yields")
async def macro_yields():
    """Current Treasury yields: 3M, 2Y, 5Y, 10Y, 30Y."""
    return await macro_service.get_yields()


@router.get("/fed-rate")
async def macro_fed_rate():
    """Fed Funds effective rate (FRED) or implied rate (ZQ=F futures)."""
    return await macro_service.get_fed_rate()


@router.get("/yield-curve")
async def macro_yield_curve(days: int = Query(default=365, le=3650)):
    """2Y/10Y historical data for yield curve charting (FRED)."""
    return await macro_service.get_yield_curve_history(days=days)


@router.get("/economic-indicators")
async def macro_economic_indicators():
    """FRED economic data: GDP, CPI, unemployment, M2, Fed balance sheet."""
    return await macro_service.get_economic_indicators()