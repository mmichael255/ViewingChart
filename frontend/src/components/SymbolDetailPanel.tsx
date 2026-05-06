"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { PriceHighlight } from "./Highlighting";
import type { KlineData, TickerData, WatchlistItem } from "@/types/market";
import {
    computePerformanceRows,
    computeSeasonalMonthlyCells,
    type SeasonalMonthCell,
} from "@/lib/symbolDetailAnalytics";
import { calculateEMA, calculateRSI } from "@/utils/indicators";

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
        <div className="rounded-lg border border-gray-600/50 bg-gradient-to-b from-[#2a3040] to-[#232834] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-gray-600/40">
                <span className="h-2 w-0.5 rounded-full bg-[#2962FF] shrink-0" aria-hidden />
                <span className="text-[10px] font-black text-gray-200 uppercase tracking-widest leading-none">
                    {title}
                </span>
            </div>
            {children}
        </div>
    );
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex justify-between items-baseline gap-3 text-[12px] py-1.5 first:pt-0 border-b border-gray-700/50 last:border-0 last:pb-0">
            <span className="text-gray-400 shrink-0 font-medium">{label}</span>
            <span className="text-gray-100 tabular-nums text-right font-semibold truncate">{value}</span>
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

function PerformanceTable({ rows }: { rows: { label: string; pct: number | null }[] }) {
    return (
        <div className="rounded-md border border-gray-600/35 bg-black/25 overflow-hidden">
            {rows.map((r) => (
                <div
                    key={r.label}
                    className="flex justify-between items-center gap-2 px-2.5 py-2 border-b border-gray-700/40 last:border-0 text-[12px]"
                >
                    <span className="text-gray-300 font-semibold tabular-nums w-9 shrink-0">{r.label}</span>
                    <span className="tabular-nums">{formatPerfPct(r.pct)}</span>
                </div>
            ))}
        </div>
    );
}

function SeasonalsGrid({ cells }: { cells: SeasonalMonthCell[] }) {
    return (
        <div className="grid grid-cols-4 gap-1.5">
            {cells.map((c) => {
                const v = c.avgPct;
                const has = v != null && Number.isFinite(v) && c.sampleYears > 0;
                const up = has && (v as number) >= 0;
                const bg = !has
                    ? "bg-gray-800/40 border-gray-700/50"
                    : up
                      ? "bg-emerald-950/70 border-emerald-700/40"
                      : "bg-rose-950/70 border-rose-700/40";
                return (
                    <div
                        key={c.label}
                        className={`rounded border px-1 py-1.5 text-center ${bg}`}
                        title={has ? `Avg. ${(v as number).toFixed(2)}% · ${c.sampleYears} month(s) in data` : "No data"}
                    >
                        <div className="text-[9px] font-black text-gray-400 uppercase tracking-tight">{c.label}</div>
                        <div
                            className={`text-[11px] font-bold tabular-nums mt-0.5 ${
                                !has ? "text-gray-500" : up ? "text-emerald-300" : "text-rose-300"
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
            return { rsi: null as number | null, emaFast: null as number | null, emaSlow: null as number | null };
        }
        const rsiSeries = calculateRSI(klines, 14);
        const ema7 = calculateEMA(klines, 7);
        const ema25 = calculateEMA(klines, 25);
        const lastRsi = rsiSeries[rsiSeries.length - 1]?.value;
        const rsi = typeof lastRsi === "number" && Number.isFinite(lastRsi) ? lastRsi : null;
        const ef = ema7[ema7.length - 1]?.value;
        const es = ema25[ema25.length - 1]?.value;
        return {
            rsi,
            emaFast: typeof ef === "number" && Number.isFinite(ef) ? ef : null,
            emaSlow: typeof es === "number" && Number.isFinite(es) ? es : null,
        };
    }, [klines]);

    const isStock = assetType === "stock";

    const performanceRows = useMemo(() => computePerformanceRows(klines ?? []), [klines]);

    const seasonalCells = useMemo(() => computeSeasonalMonthlyCells(klines ?? []), [klines]);
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
            <div className="flex-1 flex items-center justify-center p-4 text-gray-400 text-xs">No symbol</div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#1a1f2e]">
            <div className="shrink-0 px-3.5 py-2.5 border-b border-gray-600/50 bg-[#222836] flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2962FF] shadow-[0_0_8px_rgba(41,98,255,0.7)]" aria-hidden />
                <span className="text-[10px] font-black text-gray-200 uppercase tracking-[0.2em]">Symbol detail</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                {showLoading && (
                    <div className="flex justify-center py-8">
                        <div className="w-7 h-7 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin shadow-[0_0_12px_rgba(41,98,255,0.35)]" />
                    </div>
                )}

                {/* Header snapshot */}
                <div className="rounded-lg border border-gray-600/50 bg-gradient-to-br from-[#2e3548] via-[#282e3f] to-[#1f2433] px-3.5 py-3 shadow-lg shadow-black/20 ring-1 ring-white/[0.06]">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                            <div className="text-[15px] font-extrabold text-white tracking-tight truncate drop-shadow-sm">
                                {symbol}
                            </div>
                            {watchlistMeta?.sub && (
                                <div className="text-[11px] text-gray-400 truncate mt-1 font-medium">{watchlistMeta.sub}</div>
                            )}
                        </div>
                        <span className="text-[9px] font-bold uppercase px-2 py-1 rounded-md border border-gray-500/60 bg-gray-900/70 text-gray-200 tracking-widest shrink-0 shadow-inner">
                            {sourceBadge}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2">
                        {headerPrice != null ? (
                            <PriceHighlight price={headerPrice} className="text-lg font-bold tabular-nums" />
                        ) : (
                            <span className="text-gray-500 text-base font-semibold">—</span>
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
                        <div className="mt-3 pt-2.5 border-t border-gray-600/40 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="font-bold uppercase tracking-wider text-sky-200 bg-sky-500/20 border border-sky-500/30 px-2 py-1 rounded-md">
                                {sessionLabel[ticker.session] ?? ticker.session}
                            </span>
                            {ticker.asOf && (
                                <span className="text-gray-400 tabular-nums font-medium">{formatEtTime(ticker.asOf)} ET</span>
                            )}
                            {ticker.isStale && (
                                <span className="text-[9px] font-bold uppercase text-amber-200 bg-amber-500/20 border border-amber-500/35 px-2 py-1 rounded-md">
                                    Stale
                                </span>
                            )}
                        </div>
                    )}
                    {!isStock && ticker?.isStale && (
                        <div className="mt-3 pt-2.5 border-t border-gray-600/40">
                            <span className="text-[9px] font-bold uppercase text-amber-200 bg-amber-500/20 border border-amber-500/35 px-2 py-1 rounded-md">
                                Stale
                            </span>
                        </div>
                    )}
                </div>

                {/* Performance (calendar horizons vs loaded series) */}
                <Card title="Performance">
                    <p className="text-[10px] text-gray-400 mb-2.5 leading-snug">
                        % change vs past close on calendar horizons (UTC), same series as the chart (
                        <span className="font-semibold text-gray-300">{chartInterval}</span>).
                    </p>
                    {!klines?.length ? (
                        <p className="text-[12px] text-gray-400 leading-relaxed px-0.5">No candle data.</p>
                    ) : (
                        <PerformanceTable rows={performanceRows} />
                    )}
                </Card>

                {/* Range + volume */}
                <Card title="Range & volume">
                    {!lastBar || rangePct == null ? (
                        <p className="text-[12px] text-gray-400 leading-relaxed px-0.5">
                            Need OHLC for the active bar.
                        </p>
                    ) : (
                        <>
                            <div className="mb-3 rounded-md border border-gray-600/40 bg-black/25 p-2.5">
                                <div className="flex justify-between text-[11px] text-gray-300 mb-2 tabular-nums font-semibold">
                                    <span className="text-emerald-400/90">L {formatNumber(lastBar.low)}</span>
                                    <span className="text-rose-400/90">H {formatNumber(lastBar.high)}</span>
                                </div>
                                <div className="h-3 rounded-md bg-gradient-to-r from-emerald-950/80 via-gray-800 to-rose-950/80 relative overflow-hidden ring-1 ring-gray-600/30">
                                    <div
                                        className="absolute top-0 bottom-0 w-1 rounded-sm bg-[#2962FF] shadow-[0_0_10px_rgba(41,98,255,0.9),0_0_4px_rgba(255,255,255,0.5)]"
                                        style={{ left: `${rangePct}%`, transform: "translateX(-50%)" }}
                                    />
                                </div>
                                <div className="text-[10px] text-gray-400 mt-2 text-center font-medium">
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
                    <p className="text-[10px] text-gray-300 mb-3 leading-snug rounded-md border border-gray-600/35 bg-black/30 px-2.5 py-2">
                        Uses the same series as the main chart at{" "}
                        <span className="font-bold text-[#7aa7ff] tabular-nums">{chartInterval}</span>.
                    </p>
                    <div>
                        <StatRow
                            label="RSI(14)"
                            value={
                                technical.rsi != null ? (
                                    <span>
                                        <span className="text-white">{technical.rsi.toFixed(1)}</span>{" "}
                                        <span className="text-gray-400 text-[11px] font-medium">({rsiLabel})</span>
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
                            </>
                        )}
                    </div>
                </Card>

                {/* Seasonals — avg monthly % by calendar month across loaded history */}
                <Card title="Seasonals">
                    <p className="text-[10px] text-gray-400 mb-2.5 leading-snug">
                        Average monthly % (first open → last close of each calendar month). More history
                        yields a closer read to classic seasonality charts.
                    </p>
                    {!klines?.length ? (
                        <p className="text-[12px] text-gray-400 leading-relaxed px-0.5">No candle data.</p>
                    ) : (
                        <SeasonalsGrid cells={seasonalCells} />
                    )}
                </Card>
            </div>
        </div>
    );
}
