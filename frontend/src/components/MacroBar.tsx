"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { API_URL } from "@/config";

interface MacroDashboard {
    dxy: {
        symbol: string;
        name: string;
        price: number;
        change: number;
        change_pct: number;
    };
    yields: {
        us3m: number;
        us2y: number;
        us5y: number;
        us10y: number;
        us30y: number;
    };
    fed_rate: {
        effective_rate?: number;
        implied_rate?: number;
        note?: string;
    };
    spread_2s10s: number;
    spread_10y3m: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function deltaColor(v: number): string {
    if (v > 0) return "text-green-400";
    if (v < 0) return "text-red-400";
    return "text-gray-500";
}

function fmtDelta(v: number): string {
    const sign = v >= 0 ? "+" : "";
    return `${sign}${v.toFixed(2)}`;
}

export const MacroBar = () => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const { data } = useSWR<MacroDashboard>(
        `${API_URL}/macro/dashboard`,
        fetcher,
        { refreshInterval: 60_000 }
    );

    // SSR-safe: render empty bar until client mount
    if (!mounted || !data)
        return (
            <div className="flex items-center bg-[#0D1117] text-[#8B949E] text-[10px] border-t border-[#30363D] h-7 shrink-0 px-3 gap-5">
                DXY ··· | 10Y ··· | 2Y ··· | 2s10s ··· | 5Y ··· | 30Y ··· | Fed ···
            </div>
        );

    const { dxy, yields, fed_rate, spread_2s10s } = data;

    return (
        <div className="flex items-center bg-[#0D1117] text-[#8B949E] text-[10px] border-t border-[#30363D] h-7 shrink-0 px-3 gap-5 whitespace-nowrap overflow-x-auto scrollbar-none">
            {/* DXY */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">DXY</span>
                <span className="text-gray-200 font-medium">
                    {dxy.price.toFixed(2)}
                </span>
                <span className={deltaColor(dxy.change)}>
                    {fmtDelta(dxy.change)} ({fmtDelta(dxy.change_pct)}%)
                </span>
            </span>
            <span className="text-[#30363D]">|</span>

            {/* 10Y Yield */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">10Y</span>
                <span className="text-gray-200 font-medium">
                    {yields.us10y.toFixed(2)}%
                </span>
            </span>
            <span className="text-[#30363D]">|</span>

            {/* 2Y Yield */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">2Y</span>
                <span className="text-gray-200 font-medium">
                    {yields.us2y.toFixed(2)}%
                </span>
            </span>
            <span className="text-[#30363D]">|</span>

            {/* 2s10s Spread */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">2s10s</span>
                <span
                    className={`font-medium ${
                        spread_2s10s < 0
                            ? "text-red-400"
                            : "text-green-400"
                    }`}
                >
                    {spread_2s10s >= 0 ? "+" : ""}
                    {spread_2s10s.toFixed(2)}%
                </span>
            </span>
            <span className="text-[#30363D]">|</span>

            {/* 5Y */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">5Y</span>
                <span className="text-gray-200 font-medium">
                    {yields.us5y.toFixed(2)}%
                </span>
            </span>
            <span className="text-[#30363D]">|</span>

            {/* 30Y */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">30Y</span>
                <span className="text-gray-200 font-medium">
                    {yields.us30y.toFixed(2)}%
                </span>
            </span>
            <span className="text-[#30363D]">|</span>

            {/* Fed Rate */}
            <span className="flex items-center gap-1">
                <span className="text-gray-500">Fed</span>
                <span className="text-gray-200 font-medium">
                    {(fed_rate.effective_rate ?? fed_rate.implied_rate ?? 0).toFixed(2)}%
                </span>
            </span>
        </div>
    );
};