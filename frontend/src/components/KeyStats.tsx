"use client";

import type { TickerData } from "@/types/market";

interface KeyStatsProps {
    ticker: TickerData | undefined;
    symbol: string;
    assetType: string;
}

const fmtNum = (n: number | undefined | null): string => {
    if (n == null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(3)}T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
    return n.toFixed(2);
};

const fmtPrice = (n: number | undefined | null): string => {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1) return n.toFixed(2);
    return n.toPrecision(4);
};

const fmtPct = (n: number | undefined | null): string => {
    if (n == null || !Number.isFinite(n)) return "—";
    return n.toFixed(2) + "%";
};

const fmtDate = (d: string | number | undefined | null): string => {
    if (d == null) return "—";
    if (typeof d === "number") {
        return new Date(d * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    }
    return d;
};

interface StatRow {
    label: string;
    value: string;
}

export const KeyStats = ({ ticker, assetType }: KeyStatsProps) => {
    if (!ticker) {
        return (
            <div className="px-4 py-3 border-b border-[#30363D]">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Key Statistics</h3>
                <p className="text-[10px] text-gray-600">No data available</p>
            </div>
        );
    }

    const rows: StatRow[] = [];

    // Market Cap
    if (ticker.marketCap) {
        rows.push({ label: "Market Cap", value: fmtNum(ticker.marketCap) });
    }

    // Fully Diluted / Enterprise Value
    const fdv = ticker.fullyDilutedValuation ?? ticker.enterpriseValue;
    if (fdv) {
        rows.push({ label: "Fully Diluted Valuation", value: fmtNum(fdv) });
    }

    // Volume
    const vol = ticker.totalVolume ?? ticker.volume;
    if (vol) {
        rows.push({ label: assetType === "crypto" ? "Volume (24hr)" : "Volume", value: fmtNum(vol) });
    }

    // Previous Close
    if (ticker.previousClose != null) {
        rows.push({ label: "Previous Close", value: fmtPrice(ticker.previousClose) });
    }

    // Open
    const openVal = ticker.openPrice;
    if (openVal != null) {
        rows.push({ label: "Open", value: fmtPrice(openVal) });
    }

    // Day's Range
    const dayHigh = ticker.dayHigh ?? ticker.highPrice ?? ticker.high24h;
    const dayLow = ticker.dayLow ?? ticker.lowPrice ?? ticker.low24h;
    if (dayHigh != null && dayLow != null) {
        rows.push({ label: "Day's Range", value: `${fmtPrice(dayLow)} - ${fmtPrice(dayHigh)}` });
    }

    // 52 Week Range
    if (ticker.fiftyTwoWeekHigh != null && ticker.fiftyTwoWeekLow != null) {
        rows.push({ label: "52 Week Range", value: `${fmtPrice(ticker.fiftyTwoWeekLow)} - ${fmtPrice(ticker.fiftyTwoWeekHigh)}` });
    }

    // Start Date
    const start = ticker.startDate ?? ticker.genesisDate;
    if (start) {
        rows.push({ label: "Start Date", value: fmtDate(start) });
    }

    // Vol / Market Cap
    const effVol = ticker.totalVolume ?? ticker.volume;
    if (effVol && ticker.marketCap) {
        const ratio = (effVol / ticker.marketCap) * 100;
        rows.push({ label: "Vol/Market Cap (24hr)", value: fmtPct(ratio) });
    }

    // Circulating Supply (crypto)
    if (ticker.circulatingSupply) {
        rows.push({ label: "Circulating Supply", value: fmtNum(ticker.circulatingSupply) });
    }

    // Total Supply (crypto)
    if (ticker.totalSupply) {
        rows.push({ label: "Total Supply", value: fmtNum(ticker.totalSupply) });
    }

    // Max Supply (crypto)
    if (ticker.maxSupply) {
        rows.push({ label: "Max Supply", value: fmtNum(ticker.maxSupply) });
    }

    // Shares Outstanding (stocks)
    if (ticker.sharesOutstanding) {
        rows.push({ label: "Shares Outstanding", value: fmtNum(ticker.sharesOutstanding) });
    }

    // Float (stocks)
    if (ticker.floatShares) {
        rows.push({ label: "Float", value: fmtNum(ticker.floatShares) });
    }

    // Market Cap Rank
    if (ticker.marketCapRank) {
        rows.push({ label: "Market Cap Rank", value: `#${ticker.marketCapRank}` });
    }

    // Sector (stocks)
    if (ticker.sector) {
        rows.push({ label: "Sector", value: ticker.sector });
    }

    // Industry (stocks)
    if (ticker.industry) {
        rows.push({ label: "Industry", value: ticker.industry });
    }

    return (
        <div className="px-4 py-3 border-b border-[#30363D]">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Key Statistics
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                {rows.map((row, i) => (
                    <div
                        key={i}
                        className="flex justify-between items-baseline border-b border-[#30363D]/30 pb-1 pt-0.5"
                    >
                        <span className="text-[11px] text-gray-500">{row.label}</span>
                        <span className="text-[11px] text-gray-200 tabular-nums font-medium ml-2 shrink-0 text-right">
                            {row.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};