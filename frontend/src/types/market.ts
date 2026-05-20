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
    // Price range fields (from Binance enriched ticker)
    highPrice?: number;
    lowPrice?: number;
    volume?: number;
    quoteVolume?: number;
    openPrice?: number;
    // Fundamental fields (crypto via CoinGecko, stocks via yfinance)
    marketCap?: number;
    enterpriseValue?: number;
    fullyDilutedValuation?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    dayHigh?: number;
    dayLow?: number;
    avgVolume?: number;
    sharesOutstanding?: number;
    floatShares?: number;
    circulatingSupply?: number;
    totalSupply?: number;
    maxSupply?: number;
    ath?: number;
    atl?: number;
    genesisDate?: string;
    startDate?: string | number;
    marketCapRank?: number;
    sector?: string;
    industry?: string;
    // CoinGecko fields
    totalVolume?: number;
    high24h?: number;
    low24h?: number;
}

export interface WatchlistItem {
    id?: number;
    sym: string;
    label: string;
    sub: string;
    source?: string;
    asset_type?: "crypto" | "stock";
    position?: number;
}
