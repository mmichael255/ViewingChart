import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';

// ─── Renderer ──────────────────────────────────────────────────
class TrendLineRenderer implements IPrimitivePaneRenderer {
    private _x1: number;
    private _y1: number;
    private _x2: number;
    private _y2: number;
    private _color: string;
    private _lineWidth: number;
    private _lineStyle: 'solid' | 'dashed' | 'dotted';
    private _selected: boolean;

    constructor(
        x1: number, y1: number, x2: number, y2: number,
        color: string, lineWidth: number, lineStyle: 'solid' | 'dashed' | 'dotted',
        selected: boolean
    ) {
        this._x1 = x1; this._y1 = y1;
        this._x2 = x2; this._y2 = y2;
        this._color = color;
        this._lineWidth = lineWidth;
        this._lineStyle = lineStyle;
        this._selected = selected;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
            // Main line
            ctx.beginPath();
            ctx.moveTo(this._x1, this._y1);
            ctx.lineTo(this._x2, this._y2);
            ctx.strokeStyle = this._color;
            ctx.lineWidth = this._lineWidth;
            DrawingPrimitive.setLineStyle(ctx, this._lineStyle);
            ctx.stroke();
            ctx.setLineDash([]);

            // Control points when selected
            if (this._selected) {
                DrawingPrimitive.drawControlPoint(ctx, this._x1, this._y1, this._color);
                DrawingPrimitive.drawControlPoint(ctx, this._x2, this._y2, this._color);
            }
        });
    }
}

// ─── View ──────────────────────────────────────────────────────
class TrendLinePaneView implements IPrimitivePaneView {
    private _renderer: TrendLineRenderer | null = null;
    private _primitive: TrendLinePrimitive;

    constructor(primitive: TrendLinePrimitive) {
        this._primitive = primitive;
    }

    update(): void {
        const points = this._primitive.points;
        if (points.length < 2) { this._renderer = null; return; }

        const x1 = this._primitive['timeToX'](points[0].time);
        const y1 = this._primitive['priceToY'](points[0].price);
        const x2 = this._primitive['timeToX'](points[1].time);
        const y2 = this._primitive['priceToY'](points[1].price);

        if (x1 === null || y1 === null || x2 === null || y2 === null) {
            this._renderer = null;
            return;
        }

        this._renderer = new TrendLineRenderer(
            x1, y1, x2, y2,
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
export class TrendLinePrimitive extends DrawingPrimitive {
    private _paneView: TrendLinePaneView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, style);
        this._paneView = new TrendLinePaneView(this);
    }

    updateAllViews(): void {
        this._paneView.update();
    }

    paneViews(): IPrimitivePaneView[] {
        return [this._paneView];
    }

    hitTest(px: number, py: number): PrimitiveHoveredItem | null {
        const points = this._points;
        if (points.length < 2) return null;
        const x1 = this.timeToX(points[0].time);
        const y1 = this.priceToY(points[0].price);
        const x2 = this.timeToX(points[1].time);
        const y2 = this.priceToY(points[1].price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
        return DrawingPrimitive.distToSegment(px, py, x1, y1, x2, y2) < 8
            ? { cursorStyle: 'pointer', externalId: this.id, zOrder: 'top' }
            : null;
    }
}
