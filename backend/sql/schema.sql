-- ViewingChart Database Schema
-- Run with: mysql -u root -p < backend/sql/schema.sql
-- Or: mysql -u $DB_USER -p$DB_PASSWORD -h $DB_HOST < backend/sql/schema.sql
--
-- klines columns avoid MySQL reserved words (INTERVAL, TIME, OPEN, CLOSE, etc.)

-- Create database
CREATE DATABASE IF NOT EXISTS viewingchart;
USE viewingchart;

-- Symbols: all market symbols by category
CREATE TABLE IF NOT EXISTS symbols (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    base_asset VARCHAR(16) NOT NULL,
    quote_asset VARCHAR(16) NOT NULL,
    asset_type ENUM('crypto', 'stock') NOT NULL,
    source VARCHAR(32) NOT NULL,
    name VARCHAR(128) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_symbol_asset (symbol, asset_type),
    INDEX idx_asset_source (asset_type, source)
);

-- Klines: OHLCV candles (no reserved-word column names)
CREATE TABLE IF NOT EXISTS klines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol_id INT NOT NULL,
    bar_interval VARCHAR(8) NOT NULL,
    open_time INT NOT NULL COMMENT 'Unix seconds, candle open',
    open_price DECIMAL(24,8) NOT NULL,
    high_price DECIMAL(24,8) NOT NULL,
    low_price DECIMAL(24,8) NOT NULL,
    close_price DECIMAL(24,8) NOT NULL,
    base_volume DECIMAL(32,8) NOT NULL,
    UNIQUE KEY uk_kline_symbol_bar_time (symbol_id, bar_interval, open_time),
    INDEX idx_kline_symbol_bar_time (symbol_id, bar_interval, open_time),
    FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
);
