"use client";

import { SymbolHeader } from "./SymbolHeader";
import { MiniChart } from "./MiniChart";
import { KeyStats } from "./KeyStats";
import { QuickTechnicals } from "./QuickTechnicals";
import { SymbolNews } from "./SymbolNews";
import { AgentInsight } from "./AgentInsight";
import type { KlineData, TickerData } from "@/types/market";

interface SymbolOverviewProps {
    symbol: string;
    assetType: string;
    ticker: TickerData | undefined;
    klines: KlineData[] | undefined;
    symbolName?: string;
    marketRank?: string;
    onOpenChart?: () => void;
    onMiniChartData?: (klines: KlineData[]) => void;
}

export const SymbolOverview = ({
    symbol,
    assetType,
    ticker,
    klines,
    symbolName,
    marketRank,
    onOpenChart,
    onMiniChartData,
}: SymbolOverviewProps) => {
    return (
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#0D1117]">
            <SymbolHeader
                symbol={symbol}
                ticker={ticker}
                assetType={assetType}
                name={symbolName}
                marketRank={marketRank}
            />

            <MiniChart
                symbol={symbol}
                assetType={assetType}
                onOpenChart={onOpenChart}
                onDataChange={onMiniChartData}
            />

            <KeyStats
                ticker={ticker}
                symbol={symbol}
                assetType={assetType}
            />

            <QuickTechnicals klines={klines} />

            <SymbolNews symbol={symbol} />

            <AgentInsight
                symbol={symbol}
                symbolName={symbolName}
            />

            {/* Bottom padding for scroll */}
            <div className="h-4 shrink-0" />
        </div>
    );
};