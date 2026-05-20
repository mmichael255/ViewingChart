"use client";

import { useMemo } from "react";
import type { KlineData } from "@/types/market";

interface QuickTechnicalsProps {
    klines: KlineData[] | undefined;
}

interface Indicator {
    name: string;
    value: string;
    signal: "bullish" | "bearish" | "neutral";
    detail: string;
}

function calcSMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    const changes = closes.slice(-period - 1);
    let gains = 0, losses = 0;
    for (let i = 1; i < changes.length; i++) {
        const diff = changes[i] - changes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macd = ema12 - ema26;
    // Simplified: signal = EMA(9) of last few MACD values approximated
    const signal = macd * 0.85; // rough approximation
    return { macd, signal, histogram: macd - signal };
}

export const QuickTechnicals = ({ klines }: QuickTechnicalsProps) => {
    const indicators = useMemo<Indicator[]>(() => {
        if (!klines || klines.length < 30) return [];

        const closes = klines.map((k) => k.close);
        const lastPrice = closes[closes.length - 1];

        const ma7 = calcSMA(closes, 7);
        const ma25 = calcSMA(closes, 25);
        const ma99 = closes.length >= 99 ? calcSMA(closes, 99) : 0;
        const rsi = calcRSI(closes, 14);
        const { macd, histogram } = calcMACD(closes);

        const rsiSignal: Indicator["signal"] =
            rsi > 70 ? "bearish" : rsi < 30 ? "bullish" : "neutral";
        const macdSignal: Indicator["signal"] =
            histogram > 0 ? "bullish" : "bearish";
        const maSignal: Indicator["signal"] =
            lastPrice > ma25 ? "bullish" : "bearish";

        const results: Indicator[] = [
            {
                name: "RSI(14)",
                value: rsi.toFixed(1),
                signal: rsiSignal,
                detail:
                    rsi > 70
                        ? "Overbought"
                        : rsi < 30
                          ? "Oversold"
                          : "Neutral",
            },
            {
                name: `MA(7)`,
                value: ma7.toFixed(2),
                signal: lastPrice > ma7 ? "bullish" : "bearish",
                detail: lastPrice > ma7 ? "Price above" : "Price below",
            },
            {
                name: `MA(25)`,
                value: ma25.toFixed(2),
                signal: maSignal,
                detail: lastPrice > ma25 ? "Price above" : "Price below",
            },
            {
                name: "MACD",
                value: macd.toFixed(4),
                signal: macdSignal,
                detail:
                    histogram > 0
                        ? "Bullish crossover"
                        : "Bearish crossover",
            },
        ];

        if (ma99 > 0) {
            results.push({
                name: `MA(99)`,
                value: ma99.toFixed(2),
                signal: lastPrice > ma99 ? "bullish" : "bearish",
                detail: lastPrice > ma99 ? "Price above" : "Price below",
            });
        }

        return results;
    }, [klines]);

    if (!indicators.length) return null;

    const signalColors = {
        bullish: "text-green-400",
        bearish: "text-red-400",
        neutral: "text-yellow-400",
    };
    const signalDots = {
        bullish: "bg-green-400",
        bearish: "bg-red-400",
        neutral: "bg-yellow-400",
    };

    return (
        <div className="px-4 py-3 border-b border-[#30363D]">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Technicals
            </h3>
            <div className="space-y-1.5">
                {indicators.map((ind) => (
                    <div
                        key={ind.name}
                        className="flex items-center justify-between"
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${signalDots[ind.signal]}`}
                            />
                            <span className="text-[10px] text-gray-400">
                                {ind.name}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-200 tabular-nums">
                                {ind.value}
                            </span>
                            <span
                                className={`text-[9px] ${signalColors[ind.signal]}`}
                            >
                                {ind.detail}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};