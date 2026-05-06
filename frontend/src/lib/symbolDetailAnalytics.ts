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

export type SeasonalYearPoint = {
    /**
     * UTC timestamp (seconds) on the base year (2000). All years are projected
     * onto this base year so they share the same x-axis.
     */
    time: number;
    /** Calendar month (1-12) of the original date. */
    month: number;
    /** Calendar day-of-month (1-31) of the original date. */
    day: number;
    /** Cumulative % change vs. year-start close. */
    value: number;
};

export type SeasonalYearLine = {
    year: number;
    color: string;
    data: SeasonalYearPoint[];
};

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

/**
 * TradingView-style seasonals: compare cumulative % return within each calendar year,
 * aligned by month/day (x-axis is a normalized "base year" calendar).
 *
 * Implementation notes:
 * - Uses UTC calendar day buckets.
 * - For each day, uses the last close of that UTC day.
 * - Cumulative return is (close / firstCloseOfYear - 1) * 100.
 */
export function computeSeasonalYearCompareSeries(klines: KlineData[], years = 3): SeasonalYearLine[] {
    if (!klines?.length || years <= 0) return [];

    const BASE_YEAR = 2000; // leap year; supports Feb 29 alignment
    // Newest-first palette: current year = blue, matching TradingView seasonals.
    const palette = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444"];

    /** Project (month, day) onto the base year, returning UTC seconds. */
    const projectMs = (month: number, day: number): number => {
        const ms = Date.UTC(BASE_YEAR, month - 1, day);
        return Math.floor(ms / 1000);
    };

    // 1) Bucket by UTC year -> UTC day -> last close
    const byYearDay = new Map<number, Map<string, { ms: number; close: number }>>();

    for (const k of klines) {
        const ms = barTimeToMs(k.time);
        if (ms == null) continue;
        const close = typeof k.close === "number" ? k.close : Number(k.close);
        if (!Number.isFinite(close)) continue;

        const d = new Date(ms);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        const key = `${m}-${day}`;

        if (!byYearDay.has(y)) byYearDay.set(y, new Map());
        const map = byYearDay.get(y) as Map<string, { ms: number; close: number }>;
        const cur = map.get(key);
        if (!cur || ms >= cur.ms) {
            map.set(key, { ms, close });
        }
    }

    const yearsAvail = Array.from(byYearDay.keys()).sort((a, b) => a - b);
    const selected = yearsAvail.slice(Math.max(0, yearsAvail.length - years));

    // 2) For each year, sort by ms and compute cumulative %
    const out: SeasonalYearLine[] = [];
    for (let i = 0; i < selected.length; i++) {
        const y = selected[i];
        const map = byYearDay.get(y);
        if (!map) continue;

        const days = Array.from(map.values()).sort((a, b) => a.ms - b.ms);
        if (!days.length) continue;
        const firstClose = days[0].close;
        if (!Number.isFinite(firstClose) || firstClose === 0) continue;

        const data: SeasonalYearPoint[] = [];
        for (const item of days) {
            const dd = new Date(item.ms);
            const m = dd.getUTCMonth() + 1;
            const day = dd.getUTCDate();
            // Skip Feb 29 for non-leap years projecting onto leap base year — but if
            // the source year is leap (so we have a Feb 29 reading), the projection
            // {2000, 2, 29} is valid since 2000 is also leap.
            const t = projectMs(m, day);
            const pct = (item.close / firstClose - 1) * 100;
            if (!Number.isFinite(pct)) continue;
            data.push({ time: t, month: m, day, value: pct });
        }

        // De-duplicate same projected day (e.g. multiple intra-day rows already
        // collapsed earlier — keep the last) and ensure ascending order.
        const dedup = new Map<number, SeasonalYearPoint>();
        for (const p of data) dedup.set(p.time, p);
        const sorted = Array.from(dedup.values()).sort((a, b) => a.time - b.time);

        // newest-first index for color (0 = current year, 1 = prior, ...)
        const newestIndex = selected.length - 1 - i;
        out.push({ year: y, color: palette[newestIndex % palette.length], data: sorted });
    }

    // Return newest first so the current year line draws on top.
    return out.sort((a, b) => b.year - a.year);
}
