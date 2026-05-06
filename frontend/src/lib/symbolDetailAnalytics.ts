import type { KlineData } from "@/types/market";

/** Normalize bar time to UTC milliseconds (API uses seconds; some feeds use ms). */
export function barTimeToMs(t: KlineData["time"]): number | null {
    if (t == null) return null;
    if (typeof t === "number") {
        if (!Number.isFinite(t)) return null;
        return t > 1e12 ? t : t * 1000;
    }
    if (typeof t === "string") {
        if (/^\d+$/.test(t)) {
            const n = Number(t);
            if (!Number.isFinite(n)) return null;
            return n > 1e12 ? n : n * 1000;
        }
        const p = Date.parse(t);
        return Number.isFinite(p) ? p : null;
    }
    return null;
}

function findIdxAtOrBefore(sortedMs: number[], targetMs: number): number {
    let lo = 0;
    let hi = sortedMs.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sortedMs[mid] <= targetMs) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

export type PerformanceRow = { label: string; pct: number | null };

const PERF_LABELS = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y"] as const;

function emptyPerformance(): PerformanceRow[] {
    return PERF_LABELS.map((label) => ({ label, pct: null }));
}

/** Calendar-based performance vs last bar close (TradingView-style horizons). */
export function computePerformanceRows(klines: KlineData[]): PerformanceRow[] {
    const valid = klines.filter((k) => barTimeToMs(k.time) != null);
    if (!valid.length) return [];

    const times: number[] = [];
    for (const k of valid) {
        times.push(barTimeToMs(k.time) as number);
    }
    for (let i = 1; i < times.length; i++) {
        if (times[i] < times[i - 1]) return emptyPerformance();
    }

    const lastIdx = valid.length - 1;
    const anchorMs = times[lastIdx];
    const lastClose = Number(valid[lastIdx].close);
    if (!Number.isFinite(lastClose) || lastClose === 0) return emptyPerformance();

    const pctFromCloseIdx = (idx: number): number | null => {
        if (idx < 0) return null;
        const past = Number(valid[idx].close);
        if (!Number.isFinite(past) || past === 0) return null;
        return (lastClose / past - 1) * 100;
    };

    const targetMs = (fn: (d: Date) => void): number => {
        const d = new Date(anchorMs);
        fn(d);
        return d.getTime();
    };

    const anchorY = new Date(anchorMs).getUTCFullYear();
    let ytdIdx = -1;
    for (let i = 0; i < times.length; i++) {
        if (new Date(times[i]).getUTCFullYear() === anchorY) {
            ytdIdx = i;
            break;
        }
    }
    let ytdPct: number | null = null;
    if (ytdIdx >= 0) {
        const y0 = Number(valid[ytdIdx].open);
        if (Number.isFinite(y0) && y0 !== 0) {
            ytdPct = (lastClose / y0 - 1) * 100;
        }
    }

    const horizonRows: { label: string; target: number }[] = [
        { label: "1D", target: targetMs((d) => d.setUTCDate(d.getUTCDate() - 1)) },
        { label: "5D", target: targetMs((d) => d.setUTCDate(d.getUTCDate() - 5)) },
        { label: "1M", target: targetMs((d) => d.setUTCMonth(d.getUTCMonth() - 1)) },
        { label: "3M", target: targetMs((d) => d.setUTCMonth(d.getUTCMonth() - 3)) },
        { label: "6M", target: targetMs((d) => d.setUTCMonth(d.getUTCMonth() - 6)) },
        { label: "1Y", target: targetMs((d) => d.setUTCFullYear(d.getUTCFullYear() - 1)) },
    ];

    const out: PerformanceRow[] = horizonRows.map(({ label, target }) => ({
        label,
        pct: pctFromCloseIdx(findIdxAtOrBefore(times, target)),
    }));
    out.splice(5, 0, { label: "YTD", pct: ytdPct });
    return out;
}

export type SeasonalMonthCell = {
    monthIndex: number; // 0–11
    label: string;
    avgPct: number | null;
    sampleYears: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Average calendar-month % return across years in the series (full months only),
 * similar in spirit to TradingView seasonals (simplified; uses first open → last close per month).
 */
export function computeSeasonalMonthlyCells(klines: KlineData[]): SeasonalMonthCell[] {
    const byMonth: Record<number, number[]> = {};
    for (let m = 0; m < 12; m++) byMonth[m] = [];

    let cur: { y: number; m: number; firstOpen: number; lastClose: number } | null = null;

    const flush = () => {
        if (!cur) return;
        const o = cur.firstOpen;
        const c = cur.lastClose;
        if (Number.isFinite(o) && o !== 0 && Number.isFinite(c)) {
            byMonth[cur.m - 1].push((c / o - 1) * 100);
        }
        cur = null;
    };

    for (const k of klines) {
        const ms = barTimeToMs(k.time);
        if (ms == null) continue;
        const d = new Date(ms);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const o = typeof k.open === "number" ? k.open : Number(k.open);
        const c = typeof k.close === "number" ? k.close : Number(k.close);
        if (!cur || cur.y !== y || cur.m !== m) {
            flush();
            cur = { y, m, firstOpen: o, lastClose: c };
        } else {
            cur.lastClose = c;
        }
    }
    flush();

    return MONTH_LABELS.map((label, monthIndex) => {
        const arr = byMonth[monthIndex];
        if (!arr.length) {
            return { monthIndex, label, avgPct: null, sampleYears: 0 };
        }
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        return { monthIndex, label, avgPct: avg, sampleYears: arr.length };
    });
}
