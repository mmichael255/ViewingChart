"use client";

import { useRef, useEffect, useState } from "react";
import useSWR from "swr";
import { createChart, ColorType, LineSeries } from "lightweight-charts";
import { API_URL } from "@/config";
import type { KlineData } from "@/types/market";

const RANGES = [
    { label: "24H", interval: "15m", limit: 100, fallbackInterval: "1h", hoursBack: 24 },
    { label: "5D",  interval: "15m", limit: 500, fallbackInterval: "1h", hoursBack: 120 },
    { label: "1M",  interval: "1h",  limit: 750, hoursBack: 720 },
    { label: "6M",  interval: "4h",  limit: 1100, hoursBack: 4320 },
    { label: "YTD", interval: "1d",  limit: 260, ytd: true },
    { label: "1Y",  interval: "1d",  limit: 400, hoursBack: 8760 },
    { label: "5Y",  interval: "1w",  limit: 260, hoursBack: 43800 },
];

const FX_SYMBOLS = (s: string) => s.startsWith("XAU") || s.startsWith("XAG");

/** Midnight-aligned start for crypto (24/7 markets, calendar boundaries).
 *  "24H" = today midnight → now, other ranges subtract full days from midnight. */
function cryptoStartOfRange(range: typeof RANGES[number]): number {
    const now = new Date();
    if (range.ytd) return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const h = range.label === "24H" ? 0 : (range.hoursBack ?? 0);
    return Math.floor((midnight - h * 3600_000) / 1000);
}

/** Session-covering start for stocks: pad hoursBack ×2 so yfinance has enough
 *  runway to return N trading sessions even after weekends/holidays. */
function stockStartOfRange(range: typeof RANGES[number]): number {
    const now = new Date();
    if (range.ytd) return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
    const hoursBack = (range.hoursBack ?? 0) * 2;
    return Math.floor((now.getTime() - hoursBack * 3600_000) / 1000);
}

// Stocks trade in sessions (~6.5h/day), not 24/7. Limits sized so the
// chart shows approximately the right number of sessions per range.
//   bars per session: 15m→26, 1h→7, 4h→2, 1d→1, 1w→1
const SESSION_LIMITS: Record<string, number> = {
    "24H": 27,  // 1 session
    "5D":  130, // 5 sessions
    "1M":  160, // ~22 sessions
    "6M":  260, // ~130 sessions
    "YTD": 110, // ~100 sessions (mid-May)
    "1Y":  260, // ~252 sessions
    "5Y":  260, // ~260 weeks
};

interface MiniChartProps {
    symbol: string;
    assetType: string;
    onOpenChart?: () => void;
    onDataChange?: (klines: KlineData[]) => void;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export const MiniChart = ({ symbol, assetType, onOpenChart, onDataChange }: MiniChartProps) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
    const seriesRef = useRef<any>(null);
    const [rangeIdx, setRangeIdx] = useState(0);
    const range = RANGES[rangeIdx];

    const startTime = assetType === "stock" ? stockStartOfRange(range) : cryptoStartOfRange(range);
    const effLimit = assetType === "stock" ? (SESSION_LIMITS[range.label] ?? range.limit) : range.limit;
    const effInterval = (FX_SYMBOLS(symbol) && range.fallbackInterval) ? range.fallbackInterval : range.interval;
    const { data: klines, isLoading } = useSWR<KlineData[]>(
        `${API_URL}/market/klines/${encodeURIComponent(symbol)}?interval=${effInterval}&limit=${effLimit}&start_time=${startTime}&asset_type=${assetType}`,
        fetcher,
        { refreshInterval: 60_000, keepPreviousData: true }
    );

    // Create/destroy chart on mount
    useEffect(() => {
        const container = chartContainerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            width: container.clientWidth,
            height: 260,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#8B949E",
            },
            grid: {
                vertLines: { color: "rgba(255,255,255,0.04)" },
                horzLines: { color: "rgba(255,255,255,0.04)" },
            },
            crosshair: {
                mode: 0, // hidden by default, shows on interaction
            },
            rightPriceScale: {
                borderColor: "rgba(255,255,255,0.08)",
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderColor: "rgba(255,255,255,0.08)",
                timeVisible: rangeIdx >= 2, // show time labels for 1M+
            },
            handleScroll: false,
            handleScale: false,
        });

        const series = chart.addSeries(LineSeries, {
            color: "#4ade80",
            lineWidth: 2,
        });

        chartRef.current = chart;
        seriesRef.current = series;

        const onResize = () => {
            if (container.clientWidth > 0) {
                chart.applyOptions({ width: container.clientWidth });
            }
        };
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Update data when klines change
    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !klines || !Array.isArray(klines) || klines.length === 0) return;

        const isUp = klines[klines.length - 1].close >= klines[0].close;
        const color = isUp ? "#4ade80" : "#f87171";
        series.applyOptions({ color });

        const chartData = klines.map((k) => ({
            time: (typeof k.time === "number" ? k.time : Number(k.time)) as any,
            value: k.close,
        }));

        series.setData(chartData);
        chartRef.current?.timeScale().fitContent();
    }, [klines]);

    // Notify parent of klines change (for deduplication)
    useEffect(() => {
        if (klines && Array.isArray(klines) && klines.length > 0) {
            onDataChange?.(klines);
        }
    }, [klines, onDataChange]);

    // Update timeScale visibility when range changes
    useEffect(() => {
        chartRef.current?.applyOptions({
            timeScale: { timeVisible: rangeIdx >= 2 },
        });
    }, [rangeIdx]);

    return (
        <div className="px-4 py-2 border-b border-[#30363D]">
            {/* Range tabs */}
            <div className="flex items-center gap-1 mb-2 flex-wrap">
                {RANGES.map((r, i) => (
                    <button
                        key={r.label}
                        onClick={() => setRangeIdx(i)}
                        className={`px-2.5 py-1 rounded text-[10px] font-medium cursor-pointer transition-colors ${
                            i === rangeIdx
                                ? "bg-gray-700 text-white"
                                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                        }`}
                    >
                        {r.label}
                    </button>
                ))}
                <div className="flex-1" />
                {onOpenChart && (
                    <button
                        onClick={onOpenChart}
                        className="text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 rounded px-2 py-1 cursor-pointer transition-colors ml-2"
                    >
                        Advanced Chart →
                    </button>
                )}
            </div>

            {/* Chart */}
            <div className="relative w-full h-[260px] rounded overflow-hidden">
                {isLoading && !klines && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0D1117]/80">
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] text-gray-600">
                                Loading chart...
                            </span>
                        </div>
                    </div>
                )}
                <div ref={chartContainerRef} className="w-full h-full" />
            </div>
        </div>
    );
};