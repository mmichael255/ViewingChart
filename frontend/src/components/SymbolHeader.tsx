"use client";

import type { TickerData } from "@/types/market";

interface SymbolHeaderProps {
    symbol: string;
    ticker: TickerData | undefined;
    assetType: string;
    name?: string;
    marketRank?: string;
}

function formatPrice(n: number): string {
    if (n >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(3) + "T";
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (n >= 1) return n.toFixed(2);
    return n.toPrecision(4);
}

export const SymbolHeader = ({
    symbol,
    ticker,
    assetType,
    name,
    marketRank,
}: SymbolHeaderProps) => {
    const price = ticker?.lastPrice ?? null;
    const change = ticker?.priceChange ?? 0;
    const changePct = ticker?.priceChangePercent ?? 0;
    const session = ticker?.session ?? "regular";
    const isPositive = change >= 0;
    const displayName = name ?? symbol;

    return (
        <div className="px-4 py-3 border-b border-[#30363D] bg-[#0D1117]/50">
            <div className="flex items-start justify-between">
                <div className="min-w-0">
                    {/* Symbol name */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold text-white truncate">
                            {displayName}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">
                            ({symbol})
                        </span>
                    </div>

                    {/* Meta line */}
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                        <span className="uppercase">{assetType}</span>
                        <span>·</span>
                        <span>USD</span>
                        {marketRank && (
                            <>
                                <span>·</span>
                                <span>{marketRank}</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Price + change */}
                {price != null && (
                    <div className="text-right shrink-0">
                        <div className="text-2xl font-bold text-white tabular-nums">
                            {formatPrice(price)}
                        </div>
                        <div
                            className={`text-sm font-medium tabular-nums ${
                                isPositive ? "text-green-400" : "text-red-400"
                            }`}
                        >
                            {isPositive ? "+" : ""}
                            {change.toFixed(2)} (
                            {isPositive ? "+" : ""}
                            {changePct.toFixed(2)}%)
                        </div>
                    </div>
                )}
            </div>

            {/* Session status */}
            <div className="mt-1.5 text-[10px] text-gray-500">
                {assetType === "crypto"
                    ? "24/7 Market · "
                    : session === "pre"
                      ? "Pre-Market · "
                      : session === "post"
                        ? "After-Hours · "
                        : session === "overnight"
                          ? "Overnight · "
                          : "Market Closed · "}
                Data delayed
            </div>
        </div>
    );
};