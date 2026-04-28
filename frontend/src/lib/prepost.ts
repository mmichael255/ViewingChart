import type { TickerData } from '@/types/market';

export type PrePostKind = 'pre' | 'post' | 'overnight';

export interface PrePostSegment {
    kind: PrePostKind;
    label: 'Pre' | 'Post' | 'O/N';
    price: number;
    /** Δ vs previousClose; null when previousClose is missing or 0. */
    delta: number | null;
    /** Δ% vs previousClose; null when previousClose is missing or 0. */
    deltaPct: number | null;
    /** True when this segment represents the ticker's currently active session. */
    isActiveSession: boolean;
}

function isUsablePrice(v: number | null | undefined): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Build Pre / Post / Overnight segments to render alongside a stock quote.
 * Returns at most three entries — only those with a usable price.
 *
 * Δ and Δ% are computed against `previousClose`; when previousClose is
 * missing or 0 the deltas are null and consumers should render `—`.
 */
export function buildPrePostSegments(ticker: TickerData | undefined): PrePostSegment[] {
    if (!ticker) return [];
    const prev = ticker.previousClose;
    const hasPrev = isUsablePrice(prev) && prev !== 0;
    const session = ticker.session;

    const segments: PrePostSegment[] = [];

    const push = (kind: PrePostKind, label: 'Pre' | 'Post' | 'O/N', price: number) => {
        const delta = hasPrev ? price - (prev as number) : null;
        const deltaPct = hasPrev ? (delta as number) / (prev as number) * 100 : null;
        segments.push({
            kind,
            label,
            price,
            delta,
            deltaPct,
            isActiveSession: session === kind,
        });
    };

    if (isUsablePrice(ticker.preMarketPrice)) {
        push('pre', 'Pre', ticker.preMarketPrice);
    }
    if (isUsablePrice(ticker.postMarketPrice)) {
        push('post', 'Post', ticker.postMarketPrice);
    }
    if (isUsablePrice(ticker.overnightMarketPrice)) {
        push('overnight', 'O/N', ticker.overnightMarketPrice);
    }
    return segments;
}

/** Stable suffix string for delta, e.g. " +1.23 (+0.45%)" or " —". */
export function formatPrePostDelta(seg: PrePostSegment): string {
    if (seg.delta === null || seg.deltaPct === null) return ' —';
    const sign = seg.delta > 0 ? '+' : '';
    return ` ${sign}${seg.delta.toFixed(2)} (${sign}${seg.deltaPct.toFixed(2)}%)`;
}
