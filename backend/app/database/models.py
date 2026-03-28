from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    ForeignKey,
    DateTime,
    Boolean,
    Numeric,
    Enum,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database.connection import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    watchlists = relationship("Watchlist", back_populates="user")

class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String(50), default="My Watchlist")
    
    user = relationship("User", back_populates="watchlists")
    items = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id = Column(Integer, primary_key=True, index=True)
    watchlist_id = Column(Integer, ForeignKey("watchlists.id"))
    symbol = Column(String(20), nullable=False)
    exchange = Column(String(20), default="BINANCE")
    added_at = Column(DateTime, default=datetime.utcnow)

    watchlist = relationship("Watchlist", back_populates="items")


class Symbol(Base):
    __tablename__ = "symbols"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    symbol = Column(String(32), nullable=False)
    base_asset = Column(String(16), nullable=False)
    quote_asset = Column(String(16), nullable=False)
    asset_type = Column(Enum("crypto", "stock", name="asset_type_enum"), nullable=False)
    source = Column(String(32), nullable=False)
    name = Column(String(128), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "asset_type", name="uk_symbol_asset"),
        Index("idx_asset_source", "asset_type", "source"),
    )

    klines = relationship("Kline", back_populates="symbol", cascade="all, delete-orphan")


class Kline(Base):
    """OHLCV rows. Column names avoid MySQL reserved words (INTERVAL, TIME, OPEN, CLOSE, etc.)."""

    __tablename__ = "klines"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id", ondelete="CASCADE"), nullable=False)
    bar_interval = Column(String(8), nullable=False)
    open_time = Column(Integer, nullable=False)
    open_price = Column(Numeric(24, 8), nullable=False)
    high_price = Column(Numeric(24, 8), nullable=False)
    low_price = Column(Numeric(24, 8), nullable=False)
    close_price = Column(Numeric(24, 8), nullable=False)
    base_volume = Column(Numeric(32, 8), nullable=False)

    __table_args__ = (
        UniqueConstraint("symbol_id", "bar_interval", "open_time", name="uk_kline_symbol_bar_time"),
        Index("idx_kline_symbol_bar_time", "symbol_id", "bar_interval", "open_time"),
    )

    symbol = relationship("Symbol", back_populates="klines")
