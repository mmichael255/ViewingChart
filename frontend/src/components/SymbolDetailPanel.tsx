"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PriceHighlight } from "./Highlighting";
import type { KlineData, TickerData, WatchlistItem } from "@/types/market";
import {
    computePerformanceRows,
    computeSeasonalYearCompareSeries,
    type SeasonalYearLine,
} from "@/lib/symbolDetailAnalytics";
import { calculateEMA, calculateRSI } from "@/utils/indicators";
import {
    createChart,
    ColorType,
    LineSeries,
    type IChartApi,
    type ISeriesApi,
    type Time,
    type UTCTimestamp,
} from "lightweight-charts";

const sessionLabel: Record<string, string> = {
    pre: "Pre",
    regular: "Regular",
    post: "Post",
    overnight: "Overnight",
    closed: "Closed",
};

function formatEtTime(ts?: number): string {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/New_York",
    });
}

function formatNumber(n: number, maxFrac = 4): string {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e6) return n.toExponential(2);
    if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export interface SymbolDetailPanelProps {
    symbol: string;
    assetType: string;
    chartInterval: string;
    /** Merged ticker (watchlist + extra fetch) — same source as chart toolbar */
    ticker?: TickerData;
    klines?: KlineData[];
    klinesLoading?: boolean;
    watchlistMeta?: WatchlistItem | null;
}

function Card({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <div className="rounded-lg border border-[#30363D] bg-gradient-to-b from-[#1a1a1a] to-black px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-[#30363D]/40">
                <span className="h-2 w-0.5 rounded-full bg-[#D1D5DB] shrink-0" aria-hidden />
                <span className="text-xs font-black text-[#E6EDF3] uppercase tracking-widest leading-none">
                    {title}
                </span>
            </div>
            {children}
        </div>
    );
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex justify-between items-baseline gap-3 text-sm py-1.5 first:pt-0 border-b border-[#30363D]/50 last:border-0 last:pb-0">
            <span className="text-[#8B949E] shrink-0 font-medium">{label}</span>
            <span className="text-[#E6EDF3] tabular-nums text-right font-semibold truncate">{value}</span>
        </div>
    );
}

function formatPerfPct(pct: number | null): ReactNode {
    if (pct == null || !Number.isFinite(pct)) return <span className="text-gray-500 font-medium">—</span>;
    const up = pct >= 0;
    const cls = up ? "text-emerald-400" : "text-rose-400";
    const sign = up ? "+" : "";
    return (
        <span className={`tabular-nums font-bold ${cls}`}>
            {sign}
            {pct.toFixed(2)}%
        </span>
    );
}

function PerformanceGrid({ rows }: { rows: { label: string; pct: number | null }[] }) {
    return (
        <div className="grid grid-cols-4 gap-1.5">
            {rows.map((r) => {
                const v = r.pct;
                const has = v != null && Number.isFinite(v);
                const up = has && (v as number) >= 0;
                const bg = !has
                    ? "bg-[#30363D]/40 border-[#30363D]/50"
                    : up
                      ? "bg-emerald-950/70 border-emerald-700/40"
                      : "bg-rose-950/70 border-rose-700/40";
                return (
                    <div
                        key={r.label}
                        className={`rounded border px-1 py-1.5 text-center ${bg}`}
                        title={has ? `${(v as number).toFixed(2)}%` : "No data"}
                    >
                        <div className="text-xs font-black text-[#8B949E] uppercase tracking-tight">{r.label}</div>
                        <div
                            className={`text-xs font-bold tabular-nums mt-0.5 ${
                                !has ? "text-[#6E7681]" : up ? "text-emerald-300" : "text-rose-300"
                            }`}
                        >
                            {has ? `${up ? "+" : ""}${(v as number).toFixed(1)}%` : "—"}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

const SEASONAL_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

function SeasonalsYearCompareChart({ lines }: { lines: SeasonalYearLine[] }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRefs = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
    const baselineRef = useRef<ISeriesApi<"Line"> | null>(null);

    const [hover, setHover] = useState<
        | { x: number; monthLabel: string; day: number; vals: Record<number, number | null> }
        | null
    >(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const chart = createChart(el, {
            layout: {
                background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
                textColor: "#a3a3a3",
                fontSize: 11,
            },
            autoSize: true,
            grid: {
                vertLines: { color: "rgba(148,163,184,0.18)", style: 2 },
                horzLines: { color: "rgba(148,163,184,0.10)", style: 0 },
            },
            rightPriceScale: {
                borderVisible: false,
                scaleMargins: { top: 0.18, bottom: 0.12 },
            },
            timeScale: {
                borderVisible: false,
                timeVisible: false,
                visible: false,
                tickMarkFormatter: () => "",
            },
            crosshair: {
                vertLine: {
                    color: "rgba(255,255,255,0.35)",
                    width: 1,
                    style: 2,
                    visible: true,
                    labelVisible: false,
                },
                horzLine: { visible: false, labelVisible: false },
            },
            handleScroll: false,
            handleScale: false,
        });

        chartRef.current = chart;

        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRefs.current.clear();
            baselineRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        for (const [, s] of seriesRefs.current) {
            try {
                chart.removeSeries(s);
            } catch {
                // ignore
            }
        }
        seriesRefs.current.clear();

        if (baselineRef.current) {
            try {
                chart.removeSeries(baselineRef.current);
            } catch {
                // ignore
            }
            baselineRef.current = null;
        }

        if (!lines.length) return;

        const BASE_YEAR_START = Math.floor(Date.UTC(2000, 0, 1) / 1000) as UTCTimestamp;
        const BASE_YEAR_END = Math.floor(Date.UTC(2000, 11, 31) / 1000) as UTCTimestamp;

        // 0% reference line spanning the full base-year calendar.
        const baseline = chart.addSeries(LineSeries, {
            color: "rgba(255,255,255,0.45)",
            lineWidth: 1,
            lineStyle: 0,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
        });
        baseline.setData([
            { time: BASE_YEAR_START, value: 0 },
            { time: BASE_YEAR_END, value: 0 },
        ]);
        baselineRef.current = baseline;

        // Add lines oldest -> newest so the newest (current year) renders on top.
        const ascending = [...lines].sort((a, b) => a.year - b.year);
        for (const ln of ascending) {
            const s = chart.addSeries(LineSeries, {
                color: ln.color,
                lineWidth: 2,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 3,
                crosshairMarkerBorderColor: ln.color,
                crosshairMarkerBackgroundColor: ln.color,
                lastValueVisible: false,
                priceLineVisible: false,
            });
            const seriesData = ln.data.map((p) => ({
                time: p.time as UTCTimestamp,
                value: p.value,
            }));
            s.setData(seriesData);
            seriesRefs.current.set(ln.year, s);
        }

        chart.timeScale().setVisibleRange({ from: BASE_YEAR_START as Time, to: BASE_YEAR_END as Time });
    }, [lines]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        const handler = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
            if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
                setHover(null);
                return;
            }
            const ts = typeof param.time === "number" ? param.time : Number(param.time);
            const d = Number.isFinite(ts) ? new Date(ts * 1000) : null;
            const month = d ? d.getUTCMonth() + 1 : 1;
            const day = d ? d.getUTCDate() : 1;
            const monthLabel = SEASONAL_MONTHS[Math.max(0, Math.min(11, month - 1))];

            const vals: Record<number, number | null> = {};
            for (const ln of lines) {
                const s = seriesRefs.current.get(ln.year);
                if (!s) {
                    vals[ln.year] = null;
                    continue;
                }
                const v = param.seriesData.get(s) as { value?: number } | number | undefined;
                const num =
                    typeof v === "number"
                        ? v
                        : typeof v === "object" && v && typeof v.value === "number"
                          ? v.value
                          : null;
                vals[ln.year] = num != null && Number.isFinite(num) ? num : null;
            }

            const cw = containerRef.current?.clientWidth ?? 0;
            const pad = 36;
            const rawX = param.point.x;
            const x = cw > 0 ? Math.min(Math.max(rawX, pad), cw - pad) : rawX;
            setHover({ x, monthLabel, day, vals });
        };

        chart.subscribeCrosshairMove(handler);
        return () => {
            chart.unsubscribeCrosshairMove(handler);
        };
    }, [lines]);

    const hasLines = lines.length > 0;

    return (
        <div className="relative">
            {/*
              Chart + crosshair hover card (TradingView-style): compare block rides on the vertical line.
            */}
            <div className="relative" style={{ width: "100%", height: 200 }}>
                <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
                {!hasLines && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className="text-sm text-gray-400">No candle data.</p>
                    </div>
                )}
                {hasLines && hover ? (
                    <div
                        className="pointer-events-none absolute top-0 z-10 flex flex-col items-center "
                        style={{ left: hover.x, transform: "translate(-50%, -50px)" }}
                    >
                        <div className="min-w-[120px] rounded-md border border-gray-600/60 bg-[#1a1f2e]/95 px-2 py-1.5 shadow-lg shadow-black/40 backdrop-blur-sm">
                            <div className="mb-1 border-b border-gray-600/40 pb-1 text-center text-[9px] font-semibold tabular-nums text-gray-400">
                                {hover.monthLabel} {hover.day}
                            </div>
                            <div className="flex flex-col gap-1">
                                {lines.map((ln) => {
                                    const v = hover.vals[ln.year] ?? null;
                                    const up = v != null && Number.isFinite(v) && v >= 0;
                                    return (
                                        <div
                                            key={ln.year}
                                            className="flex items-center gap-2 text-xs tabular-nums leading-tight"
                                        >
                                            <span
                                                className="h-2 w-2 shrink-0 rounded-full border border-gray-900/60 ring-1 ring-black/30"
                                                style={{ backgroundColor: ln.color }}
                                            />
                                            <span className="w-[34px] shrink-0 font-semibold text-gray-200">
                                                {ln.year}
                                            </span>
                                            <span
                                                className={
                                                    v == null
                                                        ? "text-gray-500"
                                                        : up
                                                          ? "font-bold text-emerald-400"
                                                          : "font-bold text-rose-400"
                                                }
                                            >
                                                {v == null ? "—" : `${up ? "+" : ""}${v.toFixed(2)}%`}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div
                            className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-gray-600/70"
                            aria-hidden
                        />
                    </div>
                ) : null}
            </div>

            {hasLines ? (
                <div className="mt-1.5 flex justify-center gap-4 text-xs text-gray-400">
                    {lines.map((ln) => (
                            <div key={ln.year} className="flex shrink-0 items-center gap-2 tabular-nums">
                                <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: ln.color }}
                                />
                                <span>{ln.year}</span>
                            </div>
                        ))}
                </div>
            ) : null}
        </div>
    );
}

export function SymbolDetailPanel({
    symbol,
    assetType,
    chartInterval,
    ticker,
    klines,
    klinesLoading,
    watchlistMeta,
}: SymbolDetailPanelProps) {
    const lastBar = useMemo(() => {
        if (!klines?.length) return null;
        return klines[klines.length - 1];
    }, [klines]);

    const prevBarClose = useMemo(() => {
        if (!klines || klines.length < 2) return null;
        const c = klines[klines.length - 2].close;
        const n = typeof c === "number" ? c : Number(c);
        return Number.isFinite(n) ? n : null;
    }, [klines]);

    const headerPrice = useMemo(() => {
        if (ticker?.lastPrice != null && Number.isFinite(ticker.lastPrice) && ticker.lastPrice !== 0) {
            return ticker.lastPrice;
        }
        if (lastBar) {
            const c = lastBar.close;
            const n = typeof c === "number" ? c : Number(c);
            if (Number.isFinite(n)) return n;
        }
        return null;
    }, [ticker, lastBar]);

    const volumeAvg20 = useMemo(() => {
        if (!klines?.length) return null;
        const slice = klines.slice(-20);
        const vols = slice.map((k) => (typeof k.volume === "number" ? k.volume : Number(k.volume))).filter(Number.isFinite);
        if (!vols.length) return null;
        return vols.reduce((a, b) => a + b, 0) / vols.length;
    }, [klines]);

    const rangePct = useMemo(() => {
        if (!lastBar) return null;
        const low = typeof lastBar.low === "number" ? lastBar.low : Number(lastBar.low);
        const high = typeof lastBar.high === "number" ? lastBar.high : Number(lastBar.high);
        const close = typeof lastBar.close === "number" ? lastBar.close : Number(lastBar.close);
        if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low || !Number.isFinite(close)) return null;
        return Math.min(100, Math.max(0, ((close - low) / (high - low)) * 100));
    }, [lastBar]);

    const technical = useMemo(() => {
        if (!klines?.length || klines.length < 30) {
            return {
                rsi: null as number | null,
                emaFast: null as number | null,
                emaSlow: null as number | null,
                ema99: null as number | null,
            };
        }
        const rsiSeries = calculateRSI(klines, 14);
        const ema7 = calculateEMA(klines, 7);
        const ema25 = calculateEMA(klines, 25);
        const ema99 = calculateEMA(klines, 99);
        const lastRsi = rsiSeries[rsiSeries.length - 1]?.value;
        const rsi = typeof lastRsi === "number" && Number.isFinite(lastRsi) ? lastRsi : null;
        const ef = ema7[ema7.length - 1]?.value;
        const es = ema25[ema25.length - 1]?.value;
        const e99 = ema99[ema99.length - 1]?.value;
        return {
            rsi,
            emaFast: typeof ef === "number" && Number.isFinite(ef) ? ef : null,
            emaSlow: typeof es === "number" && Number.isFinite(es) ? es : null,
            ema99: typeof e99 === "number" && Number.isFinite(e99) ? e99 : null,
        };
    }, [klines]);

    const isStock = assetType === "stock";

    const performanceRows = useMemo(() => computePerformanceRows(klines ?? []), [klines]);

    const seasonalLines = useMemo(() => computeSeasonalYearCompareSeries(klines ?? [], 3), [klines]);
    const sourceBadge = watchlistMeta?.source ?? (isStock ? "Stock/FX" : "Crypto");
    const showLoading = klinesLoading && (!klines || klines.length === 0);

    const lastVol = lastBar
        ? typeof lastBar.volume === "number"
            ? lastBar.volume
            : Number(lastBar.volume)
        : null;

    const rsiLabel =
        technical.rsi == null
            ? "—"
            : technical.rsi >= 70
              ? "Overbought"
              : technical.rsi <= 30
                ? "Oversold"
                : "Neutral";

    const trendBias =
        technical.emaFast != null && technical.emaSlow != null
            ? technical.emaFast > technical.emaSlow
                ? "Bullish (EMA7 > EMA25)"
                : technical.emaFast < technical.emaSlow
                  ? "Bearish (EMA7 < EMA25)"
                  : "Flat"
            : "—";

    if (!symbol) {
        return (
            <div className="flex-1 flex items-center justify-center p-4 text-[#6E7681] text-xs">No symbol</div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-black">
            <div className="shrink-0 px-3.5 py-2.5 border-b border-[#30363D]/50 bg-black flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#D1D5DB] shadow-[0_0_8px_rgba(209,213,219,0.7)]" aria-hidden />
                <span className="text-xs font-black text-[#E6EDF3] uppercase tracking-[0.2em]">Symbol detail</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                {showLoading && (
                    <div className="flex justify-center py-8">
                        <div className="w-7 h-7 border-2 border-[#D1D5DB] border-t-transparent rounded-full animate-spin shadow-[0_0_12px_rgba(209,213,219,0.35)]" />
                    </div>
                )}

                {/* Header snapshot */}
                <div className="rounded-lg border border-[#30363D] bg-gradient-to-br from-[#1a1a1a] via-[#0d0d0d] to-black px-3.5 py-3 shadow-lg shadow-black/20 ring-1 ring-white/[0.06]">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                            <div className="text-[15px] font-extrabold text-[#E6EDF3] tracking-tight truncate drop-shadow-sm">
                                {symbol}
                            </div>
                            {watchlistMeta?.sub && (
                                <div className="text-xs text-[#8B949E] truncate mt-1 font-medium">{watchlistMeta.sub}</div>
                            )}
                        </div>
                        <span className="text-xs font-bold uppercase px-2 py-1 rounded-md border border-[#30363D]/60 bg-[#0D1117]/70 text-[#8B949E] tracking-widest shrink-0 shadow-inner">
                            {sourceBadge}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2">
                        {headerPrice != null ? (
                            <PriceHighlight price={headerPrice} className="text-lg font-bold tabular-nums" />
                        ) : (
                            <span className="text-[#6E7681] text-base font-semibold">—</span>
                        )}
                        {ticker ? (
                            <>
                                <span
                                    className={`text-xs font-bold tabular-nums ${
                                        ticker.priceChange >= 0 ? "text-green-400" : "text-red-400"
                                    }`}
                                >
                                    {ticker.priceChange >= 0 ? "+" : ""}
                                    {formatNumber(ticker.priceChange, 4)}
                                </span>
                                <span
                                    className={`text-xs font-bold tabular-nums ${
                                        ticker.priceChangePercent >= 0 ? "text-green-400" : "text-red-400"
                                    }`}
                                >
                                    ({ticker.priceChangePercent >= 0 ? "+" : ""}
                                    {ticker.priceChangePercent.toFixed(2)}%)
                                </span>
                            </>
                        ) : headerPrice != null && prevBarClose != null && prevBarClose !== 0 ? (
                            (() => {
                                const chg = headerPrice - prevBarClose;
                                const pct = (chg / prevBarClose) * 100;
                                const up = chg >= 0;
                                return (
                                    <>
                                        <span className={`text-xs font-bold tabular-nums ${up ? "text-green-400" : "text-red-400"}`}>
                                            {up ? "+" : ""}
                                            {formatNumber(chg, 4)}
                                        </span>
                                        <span className={`text-xs font-bold tabular-nums ${up ? "text-green-400" : "text-red-400"}`}>
                                            ({up ? "+" : ""}
                                            {pct.toFixed(2)}%)
                                        </span>
                                    </>
                                );
                            })()
                        ) : null}
                    </div>
                    {isStock && ticker?.session && (
                        <div className="mt-3 pt-2.5 border-t border-[#30363D]/40 flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-bold uppercase tracking-wider text-sky-200 bg-sky-500/20 border border-sky-500/30 px-2 py-1 rounded-md">
                                {sessionLabel[ticker.session] ?? ticker.session}
                            </span>
                            {ticker.asOf && (
                                <span className="text-[#6E7681] tabular-nums font-medium">{formatEtTime(ticker.asOf)} ET</span>
                            )}
                            {ticker.isStale && (
                                <span className="text-[9px] font-bold uppercase text-amber-200 bg-amber-500/20 border border-amber-500/35 px-2 py-1 rounded-md">
                                    Stale
                                </span>
                            )}
                        </div>
                    )}
                    {!isStock && ticker?.isStale && (
                        <div className="mt-3 pt-2.5 border-t border-[#30363D]/40">
                            <span className="text-[9px] font-bold uppercase text-amber-200 bg-amber-500/20 border border-amber-500/35 px-2 py-1 rounded-md">
                                Stale
                            </span>
                        </div>
                    )}
                </div>

                {/* Performance (calendar horizons vs loaded series) */}
                <Card title="Performance">
                    <p className="text-xs text-[#8B949E] mb-2.5 leading-snug">
                        % change vs past close on calendar horizons (UTC), same series as the chart (
                        <span className="font-semibold text-[#E6EDF3]">{chartInterval}</span>).
                    </p>
                    {!klines?.length ? (
                        <p className="text-xs text-[#8B949E] leading-relaxed px-0.5">No candle data.</p>
                    ) : (
                        <PerformanceGrid rows={performanceRows} />
                    )}
                </Card>

                {/* Range + volume */}
                <Card title="Range & volume">
                    {!lastBar || rangePct == null ? (
                        <p className="text-xs text-[#8B949E] leading-relaxed px-0.5">
                            Need OHLC for the active bar.
                        </p>
                    ) : (
                        <>
                            <div className="mb-3 rounded-md border border-[#30363D]/40 bg-black/25 p-2.5">
                                <div className="flex justify-between text-xs text-[#8B949E] mb-2 tabular-nums font-semibold">
                                    <span className="text-emerald-400/90">L {formatNumber(lastBar.low)}</span>
                                    <span className="text-rose-400/90">H {formatNumber(lastBar.high)}</span>
                                </div>
                                <div className="h-3 rounded-md bg-gradient-to-r from-emerald-950/80 via-gray-800 to-rose-950/80 relative overflow-hidden ring-1 ring-gray-600/30">
                                    <div
                                        className="absolute top-0 bottom-0 w-1 rounded-sm bg-[#D1D5DB] shadow-[0_0_10px_rgba(209,213,219,0.9),0_0_4px_rgba(255,255,255,0.5)]"
                                        style={{ left: `${rangePct}%`, transform: "translateX(-50%)" }}
                                    />
                                </div>
                                <div className="text-xs text-[#6E7681] mt-2 text-center font-medium">
                                    Close within bar range
                                </div>
                            </div>
                            <StatRow
                                label="Volume"
                                value={
                                    lastVol != null && Number.isFinite(lastVol)
                                        ? formatNumber(lastVol, 0)
                                        : "—"
                                }
                            />
                            {volumeAvg20 != null && lastVol != null && volumeAvg20 > 0 && (
                                <StatRow
                                    label="vs 20-bar avg"
                                    value={`${(lastVol / volumeAvg20).toFixed(2)}×`}
                                />
                            )}
                        </>
                    )}
                </Card>

                {/* Technical snapshot */}
                <Card title="Technical snapshot">
                    <p className="text-xs text-[#8B949E] mb-3 leading-snug rounded-md border border-[#30363D]/35 bg-black/30 px-2.5 py-2">
                        Uses the same series as the main chart at{" "}
                        <span className="font-bold text-[#7aa7ff] tabular-nums">{chartInterval}</span>.
                    </p>
                    <div>
                        <StatRow
                            label="RSI(14)"
                            value={
                                technical.rsi != null ? (
                                    <span>
                                        <span className="text-[#E6EDF3]">{technical.rsi.toFixed(1)}</span>{" "}
                                        <span className="text-[#6E7681] text-xs font-medium">({rsiLabel})</span>
                                    </span>
                                ) : (
                                    "—"
                                )
                            }
                        />
                        <StatRow label="EMA trend" value={trendBias} />
                        {technical.emaFast != null && technical.emaSlow != null && (
                            <>
                                <StatRow label="EMA(7)" value={formatNumber(technical.emaFast)} />
                                <StatRow label="EMA(25)" value={formatNumber(technical.emaSlow)} />
                                {technical.ema99 != null && <StatRow label="EMA(99)" value={formatNumber(technical.ema99)} />}
                            </>
                        )}
                    </div>
                </Card>

                {/* Seasonals — avg monthly % by calendar month across loaded history */}
                <Card title="Seasonals">
                    <p className="text-xs text-[#8B949E] mb-2.5 leading-snug">
                        TradingView-style: compare cumulative % return by calendar day for the most recent 3 years.
                    </p>
                    <SeasonalsYearCompareChart lines={seasonalLines} />
                </Card>
            </div>
        </div>
    );
}
