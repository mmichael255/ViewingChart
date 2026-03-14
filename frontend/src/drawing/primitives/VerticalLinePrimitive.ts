import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';

// ─── Renderer ──────────────────────────────────────────────────
class VLineRenderer implements IPrimitivePaneRenderer {
    private _x: number;
    private _color: string;
    private _lineWidth: number;
    private _lineStyle: 'solid' | 'dashed' | 'dotted';
    private _selected: boolean;

    constructor(x: number, color: string, lineWidth: number, lineStyle: 'solid' | 'dashed' | 'dotted', selected: boolean) {
        this._x = x;
        this._color = color;
        this._lineWidth = lineWidth;
        this._lineStyle = lineStyle;
        this._selected = selected;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            ctx.beginPath();
            ctx.moveTo(this._x, 0);
            ctx.lineTo(this._x, mediaSize.height);
            ctx.strokeStyle = this._color;
            ctx.lineWidth = this._lineWidth;
            DrawingPrimitive.setLineStyle(ctx, this._lineStyle);
            ctx.stroke();
            ctx.setLineDash([]);

            if (this._selected) {
                DrawingPrimitive.drawControlPoint(ctx, this._x, mediaSize.height / 2, this._color);
            }
        });
    }
}

// ─── View ──────────────────────────────────────────────────────
class VLinePaneView implements IPrimitivePaneView {
    private _renderer: VLineRenderer | null = null;
    private _primitive: VerticalLinePrimitive;

    constructor(primitive: VerticalLinePrimitive) {
        this._primitive = primitive;
    }

    update(): void {
        const points = this._primitive.points;
        if (points.length === 0) { this._renderer = null; return; }

        const x = this._primitive['timeToX'](points[0].time);
        if (x === null) { this._renderer = null; return; }

        this._renderer = new VLineRenderer(
            x,
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
export class VerticalLinePrimitive extends DrawingPrimitive {
    private _paneView: VLinePaneView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, { ...style, lineStyle: style.lineStyle || 'dashed' });
        this._paneView = new VLinePaneView(this);
    }

    updateAllViews(): void {
        this._paneView.update();
    }

    paneViews(): IPrimitivePaneView[] {
        return [this._paneView];
    }

    hitTest(px: number, _py: number): PrimitiveHoveredItem | null {
        const points = this._points;
        if (points.length === 0) return null;
        const x = this.timeToX(points[0].time);
        if (x === null) return null;
        return Math.abs(px - x) < 8 ? { cursorStyle: 'ew-resize', externalId: this.id, zOrder: 'top' } : null;
    }
}
