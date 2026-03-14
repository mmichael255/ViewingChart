import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';

// ─── Renderer ──────────────────────────────────────────────────
class RectRenderer implements IPrimitivePaneRenderer {
    private _x1: number;
    private _y1: number;
    private _x2: number;
    private _y2: number;
    private _color: string;
    private _lineWidth: number;
    private _fillOpacity: number;
    private _selected: boolean;

    constructor(
        x1: number, y1: number, x2: number, y2: number,
        color: string, lineWidth: number, fillOpacity: number,
        selected: boolean
    ) {
        this._x1 = x1; this._y1 = y1;
        this._x2 = x2; this._y2 = y2;
        this._color = color;
        this._lineWidth = lineWidth;
        this._fillOpacity = fillOpacity;
        this._selected = selected;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
            const x = Math.min(this._x1, this._x2);
            const y = Math.min(this._y1, this._y2);
            const w = Math.abs(this._x2 - this._x1);
            const h = Math.abs(this._y2 - this._y1);

            // Fill
            ctx.fillStyle = this._color + Math.round(this._fillOpacity * 255).toString(16).padStart(2, '0');
            ctx.fillRect(x, y, w, h);

            // Border
            ctx.strokeStyle = this._color;
            ctx.lineWidth = this._lineWidth;
            ctx.strokeRect(x, y, w, h);

            if (this._selected) {
                DrawingPrimitive.drawControlPoint(ctx, this._x1, this._y1, this._color);
                DrawingPrimitive.drawControlPoint(ctx, this._x2, this._y1, this._color);
                DrawingPrimitive.drawControlPoint(ctx, this._x1, this._y2, this._color);
                DrawingPrimitive.drawControlPoint(ctx, this._x2, this._y2, this._color);
            }
        });
    }
}

// ─── View ──────────────────────────────────────────────────────
class RectPaneView implements IPrimitivePaneView {
    private _renderer: RectRenderer | null = null;
    private _primitive: RectanglePrimitive;

    constructor(primitive: RectanglePrimitive) {
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

        this._renderer = new RectRenderer(
            x1, y1, x2, y2,
            this._primitive.style.color,
            this._primitive.style.lineWidth,
            this._primitive.style.fillOpacity ?? 0.1,
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
export class RectanglePrimitive extends DrawingPrimitive {
    private _paneView: RectPaneView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, { fillOpacity: 0.1, ...style });
        this._paneView = new RectPaneView(this);
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

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);

        const nearEdge =
            (Math.abs(px - left) < 6 && py >= top - 6 && py <= bottom + 6) ||
            (Math.abs(px - right) < 6 && py >= top - 6 && py <= bottom + 6) ||
            (Math.abs(py - top) < 6 && px >= left - 6 && px <= right + 6) ||
            (Math.abs(py - bottom) < 6 && px >= left - 6 && px <= right + 6);

        const inside = px >= left && px <= right && py >= top && py <= bottom;

        return (nearEdge || inside) ? { cursorStyle: 'pointer', externalId: this.id, zOrder: 'top' } : null;
    }
}
