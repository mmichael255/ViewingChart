/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
    ISeriesPrimitive,
    SeriesAttachedParameter,
    Time,
    IChartApi,
    ISeriesApi,
    IPrimitivePaneView,
    ISeriesPrimitiveAxisView,
    PrimitiveHoveredItem,
} from 'lightweight-charts';
import type { DrawingPoint, DrawingStyle } from '../drawingTypes';

/**
 * Abstract base class for all drawing primitives.
 * Implements ISeriesPrimitive<Time> and provides common utilities
 * for coordinate conversion and lifecycle management.
 */
export abstract class DrawingPrimitive implements ISeriesPrimitive<Time> {
    public readonly id: string;
    protected _points: DrawingPoint[];
    protected _style: DrawingStyle;
    protected _chart: IChartApi | null = null;
    protected _series: ISeriesApi<any> | null = null;
    protected _requestUpdate: (() => void) | null = null;
    protected _selected: boolean = false;

    constructor(id: string, points: DrawingPoint[], style: DrawingStyle) {
        this.id = id;
        this._points = [...points];
        this._style = { ...style };
    }

    // ─── ISeriesPrimitive Lifecycle ──────────────────────────────

    attached(param: SeriesAttachedParameter<Time>): void {
        this._chart = param.chart;
        this._series = param.series;
        this._requestUpdate = param.requestUpdate;
    }

    detached(): void {
        this._chart = null;
        this._series = null;
        this._requestUpdate = null;
    }

    // ─── Coordinate Conversion Helpers ───────────────────────────

    protected timeToX(time: Time): number | null {
        if (!this._chart) return null;
        return this._chart.timeScale().timeToCoordinate(time);
    }

    protected priceToY(price: number): number | null {
        if (!this._series) return null;
        return this._series.priceToCoordinate(price);
    }

    // ─── Public Accessors ────────────────────────────────────────

    get points(): DrawingPoint[] {
        return this._points;
    }

    get style(): DrawingStyle {
        return this._style;
    }

    get selected(): boolean {
        return this._selected;
    }

    setSelected(selected: boolean): void {
        this._selected = selected;
        this._requestUpdate?.();
    }

    setPoints(points: DrawingPoint[]): void {
        this._points = [...points];
        this._requestUpdate?.();
    }

    setStyle(style: Partial<DrawingStyle>): void {
        this._style = { ...this._style, ...style };
        this._requestUpdate?.();
    }

    requestUpdate(): void {
        this._requestUpdate?.();
    }

    // ─── Hit Testing (pixel coordinates) ─────────────────────────

    /** Returns PrimitiveHoveredItem if (px, py) is within interaction distance */
    abstract hitTest(px: number, py: number): PrimitiveHoveredItem | null;

    /** Returns detailed hit information distinguishing points from the body */
    hitTestPart(px: number, py: number): { part: 'point' | 'body', index?: number } | null {
        // First check control points (if selected)
        if (this._selected) {
            for (let i = 0; i < this._points.length; i++) {
                const cx = this.timeToX(this._points[i].time);
                const cy = this.priceToY(this._points[i].price);
                if (cx !== null && cy !== null) {
                    const distSq = (px - cx) ** 2 + (py - cy) ** 2;
                    if (distSq <= 64) { // radius 8
                        return { part: 'point', index: i };
                    }
                }
            }
        }

        // Then check body
        const bodyHit = this.hitTest(px, py);
        if (bodyHit) {
            return { part: 'body' };
        }

        return null;
    }

    // ─── Abstract: Subclasses must implement ─────────────────────

    abstract updateAllViews(): void;
    abstract paneViews(): IPrimitivePaneView[];

    // Optional: axis labels
    priceAxisViews?(): ISeriesPrimitiveAxisView[] {
        return [];
    }

    timeAxisViews?(): ISeriesPrimitiveAxisView[] {
        return [];
    }

    // ─── Canvas Utility Methods ──────────────────────────────────

    // ─── Drag Math ───────────────────────────────────────────────

    applyPointDelta(index: number, dx: number, dy: number): void {
        const pt = this._points[index];
        if (!pt) return;
        const cx = this.timeToX(pt.time);
        const cy = this.priceToY(pt.price);
        if (cx === null || cy === null || !this._chart || !this._series) return;

        const newTime = this._chart.timeScale().coordinateToTime(cx + dx);
        const newPrice = this._series.coordinateToPrice(cy + dy);

        if (newTime !== null && newPrice !== null) {
            this._points[index] = { time: newTime as Time, price: newPrice };
            this.requestUpdate();
        }
    }

    applyBodyDelta(dx: number, dy: number): void {
        if (!this._chart || !this._series) return;

        const newPoints = [];
        for (const pt of this._points) {
            const cx = this.timeToX(pt.time);
            const cy = this.priceToY(pt.price);
            if (cx === null || cy === null) return;

            const newTime = this._chart.timeScale().coordinateToTime(cx + dx);
            const newPrice = this._series.coordinateToPrice(cy + dy);

            if (newTime === null || newPrice === null) return;
            newPoints.push({ time: newTime as Time, price: newPrice });
        }

        this._points = newPoints;
        this.requestUpdate();
    }

    public static setLineStyle(
        ctx: CanvasRenderingContext2D,
        style: 'solid' | 'dashed' | 'dotted'
    ): void {
        switch (style) {
            case 'dashed':
                ctx.setLineDash([6, 4]);
                break;
            case 'dotted':
                ctx.setLineDash([2, 2]);
                break;
            default:
                ctx.setLineDash([]);
        }
    }

    public static drawControlPoint(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        color: string
    ): void {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /** Distance from point (px,py) to line segment (x1,y1)-(x2,y2) */
    protected static distToSegment(
        px: number, py: number,
        x1: number, y1: number,
        x2: number, y2: number
    ): number {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - x1, py - y1);

        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        return Math.hypot(px - projX, py - projY);
    }
}
