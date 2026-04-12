/**
 * Shared thresholds for TradingView-style resilience: transport vs market-data health.
 * @see docs/connection-resilience-design.md
 */

/** After tab hidden this long, force REST resync on focus (chart + watchlist). */
export const RESYNC_AFTER_HIDDEN_MS = 30_000;

/** No WebSocket frame at all (incl. JSON heartbeat) → treat transport as dead (kline). */
export const TRANSPORT_IDLE_KLINE_MS = 75_000;

/** No WebSocket frame at all → treat transport as dead (ticker). */
export const TRANSPORT_IDLE_TICKER_MS = 60_000;

/** No quote payload (non-heartbeat) while tab visible → REST snapshot for watchlist. */
export const MARKET_STALE_QUOTES_MS = 45_000;

/**
 * No kline candle payload (non-heartbeat) while tab visible → REST mutate for chart.
 * Uses ~2× bar length, capped so sparse intervals do not wait days.
 */
export function klineMarketStaleThresholdMs(interval: string): number {
    const m: Record<string, number> = {
        '1m': 120_000,
        '3m': 360_000,
        '5m': 600_000,
        '15m': 1_800_000,
        '30m': 3_600_000,
        '1h': 7_200_000,
        '4h': 28_800_000,
        '1d': 120_000,
        '1w': 600_000,
        '1M': 1_800_000,
    };
    return m[interval] ?? 120_000;
}

export type ResyncReason = 'reconnect' | 'focus_after_idle' | 'market_stale';
