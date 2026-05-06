/**
 * Shared market data types.
 * Single source of truth — import from here, not from hooks or utils.
 */

export interface KlineData {
    time: number | string | Record<string, unknown>;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface TickerData {
    lastPrice: number;
    priceChange: number;
    priceChangePercent: number;
    session?: "pre" | "regular" | "post" | "overnight" | "closed";
    preMarketPrice?: number | null;
    postMarketPrice?: number | null;
    overnightMarketPrice?: number | null;
    previousClose?: number;
    baselinePrice?: number;
    asOf?: number;
    isStale?: boolean;
}

export interface WatchlistItem {
    sym: string;
    label: string;
    sub: string;
    source?: string;
}
