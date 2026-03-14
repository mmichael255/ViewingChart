import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';

// ─── Renderer ──────────────────────────────────────────────────
class ChannelRenderer implements IPrimitivePaneRenderer {
    private _x1: number;
    private _y1: number;
    private _x2: number;
    private _y2: number;
    private _x3: number;
    private _y3: number;
    private _color: string;
    private _lineWidth: number;
    private _lineStyle: 'solid' | 'dashed' | 'dotted';
    private _selected: boolean;

    constructor(
        x1: number, y1: number, x2: number, y2: number,
        x3: number, y3: number,
        color: string, lineWidth: number, lineStyle: 'solid' | 'dashed' | 'dotted',
        selected: boolean
    ) {
        this._x1 = x1; this._y1 = y1;
        this._x2 = x2; this._y2 = y2;
        this._x3 = x3; this._y3 = y3;
        this._color = color;
        this._lineWidth = lineWidth;
        this._lineStyle = lineStyle;
        this._selected = selected;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
            const dx = this._x2 - this._x1;
            const dy = this._y2 - this._y1;
            const x4 = this._x3 + dx;
            const y4 = this._y3 + dy;

            // Fill between parallel lines
            ctx.beginPath();
            ctx.moveTo(this._x1, this._y1);
            ctx.lineTo(this._x2, this._y2);
            ctx.lineTo(x4, y4);
            ctx.lineTo(this._x3, this._y3);
            ctx.closePath();
            ctx.fillStyle = this._color + '12';
            ctx.fill();

            // Line 1 → 2
            ctx.beginPath();
            ctx.moveTo(this._x1, this._y1);
            ctx.lineTo(this._x2, this._y2);
            ctx.strokeStyle = this._color;
            ctx.lineWidth = this._lineWidth;
            DrawingPrimitive.setLineStyle(ctx, this._lineStyle);
            ctx.stroke();
            ctx.setLineDash([]);

            // Parallel line 3 → 4
            ctx.beginPath();
            ctx.moveTo(this._x3, this._y3);
            ctx.lineTo(x4, y4);
            ctx.strokeStyle = this._color;
            ctx.lineWidth = this._lineWidth;
            DrawingPrimitive.setLineStyle(ctx, this._lineStyle);
            ctx.stroke();
            ctx.setLineDash([]);

            // Middle line (dotted)
            const mx1 = (this._x1 + this._x3) / 2;
            const my1 = (this._y1 + this._y3) / 2;
            const mx2 = (this._x2 + x4) / 2;
            const my2 = (this._y2 + y4) / 2;
            ctx.beginPath();
            ctx.moveTo(mx1, my1);
            ctx.lineTo(mx2, my2);
            ctx.strokeStyle = this._color + '60';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            if (this._selected) {
                DrawingPrimitive.drawControlPoint(ctx, this._x1, this._y1, this._color);
                DrawingPrimitive.drawControlPoint(ctx, this._x2, this._y2, this._color);
                DrawingPrimitive.drawControlPoint(ctx, this._x3, this._y3, this._color);
            }
        });
    }
}

// ─── View ──────────────────────────────────────────────────────
class ChannelPaneView implements IPrimitivePaneView {
    private _renderer: ChannelRenderer | null = null;
    private _primitive: ParallelChannelPrimitive;

    constructor(primitive: ParallelChannelPrimitive) {
        this._primitive = primitive;
    }

    update(): void {
        const points = this._primitive.points;
        if (points.length < 3) { this._renderer = null; return; }

        const x1 = this._primitive['timeToX'](points[0].time);
        const y1 = this._primitive['priceToY'](points[0].price);
        const x2 = this._primitive['timeToX'](points[1].time);
        const y2 = this._primitive['priceToY'](points[1].price);
        const x3 = this._primitive['timeToX'](points[2].time);
        const y3 = this._primitive['priceToY'](points[2].price);

        if (x1 === null || y1 === null || x2 === null || y2 === null || x3 === null || y3 === null) {
            this._renderer = null;
            return;
        }

        this._renderer = new ChannelRenderer(
            x1, y1, x2, y2, x3, y3,
            this._primitive.style.color,
            this._primitive.style.lineWidth,
            this._primitive.style.lineStyle,
            this._primitive.selected,
        );
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }

    zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }
}

// ─── Primitive ─────────────────────────────────────────────────
export class ParallelChannelPrimitive extends DrawingPrimitive {
    private _paneView: ChannelPaneView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, style);
        this._paneView = new ChannelPaneView(this);
    }

    updateAllViews(): void {
        this._paneView.update();
    }

    paneViews(): IPrimitivePaneView[] {
        return [this._paneView];
    }

    hitTest(px: number, py: number): PrimitiveHoveredItem | null {
        const points = this._points;
        if (points.length < 3) return null;
        const x1 = this.timeToX(points[0].time);
        const y1 = this.priceToY(points[0].price);
        const x2 = this.timeToX(points[1].time);
        const y2 = this.priceToY(points[1].price);
        const x3 = this.timeToX(points[2].time);
        const y3 = this.priceToY(points[2].price);
        if (x1 === null || y1 === null || x2 === null || y2 === null || x3 === null || y3 === null) return null;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const x4 = x3 + dx;
        const y4 = y3 + dy;

        const d1 = DrawingPrimitive.distToSegment(px, py, x1, y1, x2, y2);
        const d2 = DrawingPrimitive.distToSegment(px, py, x3, y3, x4, y4);
        return Math.min(d1, d2) < 8 ? { cursorStyle: 'pointer', externalId: this.id, zOrder: 'top' } : null;
    }
}
