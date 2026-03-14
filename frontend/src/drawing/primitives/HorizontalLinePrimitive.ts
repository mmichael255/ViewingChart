import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, ISeriesPrimitiveAxisView, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';

// ─── Renderer ──────────────────────────────────────────────────
class HLineRenderer implements IPrimitivePaneRenderer {
    private _y: number;
    private _color: string;
    private _lineWidth: number;
    private _lineStyle: 'solid' | 'dashed' | 'dotted';
    private _selected: boolean;

    constructor(y: number, color: string, lineWidth: number, lineStyle: 'solid' | 'dashed' | 'dotted', selected: boolean) {
        this._y = y;
        this._color = color;
        this._lineWidth = lineWidth;
        this._lineStyle = lineStyle;
        this._selected = selected;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            ctx.beginPath();
            ctx.moveTo(0, this._y);
            ctx.lineTo(mediaSize.width, this._y);
            ctx.strokeStyle = this._color;
            ctx.lineWidth = this._lineWidth;
            DrawingPrimitive.setLineStyle(ctx, this._lineStyle);
            ctx.stroke();
            ctx.setLineDash([]);

            if (this._selected) {
                DrawingPrimitive.drawControlPoint(ctx, mediaSize.width / 2, this._y, this._color);
            }
        });
    }
}

// ─── Price Axis Label ──────────────────────────────────────────
class HLinePriceAxisView implements ISeriesPrimitiveAxisView {
    private _primitive: HorizontalLinePrimitive;

    constructor(primitive: HorizontalLinePrimitive) {
        this._primitive = primitive;
    }

    coordinate(): number {
        const points = this._primitive.points;
        if (points.length === 0) return 0;
        const y = this._primitive['priceToY'](points[0].price);
        return (y ?? 0);
    }

    text(): string {
        const points = this._primitive.points;
        if (points.length === 0) return '';
        return points[0].price.toFixed(2);
    }

    textColor(): string {
        return '#FFFFFF';
    }

    backColor(): string {
        return this._primitive.style.color;
    }

    visible(): boolean {
        return this._primitive.style.showLabels !== false;
    }

    tickVisible(): boolean {
        return false;
    }

    movePoint?(): string {
        return 'inside';
    }
}

// ─── View ──────────────────────────────────────────────────────
class HLinePaneView implements IPrimitivePaneView {
    private _renderer: HLineRenderer | null = null;
    private _primitive: HorizontalLinePrimitive;

    constructor(primitive: HorizontalLinePrimitive) {
        this._primitive = primitive;
    }

    update(): void {
        const points = this._primitive.points;
        if (points.length === 0) { this._renderer = null; return; }

        const y = this._primitive['priceToY'](points[0].price);
        if (y === null) { this._renderer = null; return; }

        this._renderer = new HLineRenderer(
            y,
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
export class HorizontalLinePrimitive extends DrawingPrimitive {
    private _paneView: HLinePaneView;
    private _priceAxisView: HLinePriceAxisView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, { ...style, lineStyle: style.lineStyle || 'dashed' });
        this._paneView = new HLinePaneView(this);
        this._priceAxisView = new HLinePriceAxisView(this);
    }

    updateAllViews(): void {
        this._paneView.update();
    }

    paneViews(): IPrimitivePaneView[] {
        return [this._paneView];
    }

    priceAxisViews(): ISeriesPrimitiveAxisView[] {
        return [this._priceAxisView];
    }

    hitTest(_px: number, py: number): PrimitiveHoveredItem | null {
        const points = this._points;
        if (points.length === 0) return null;
        const y = this.priceToY(points[0].price);
        if (y === null) return null;
        return Math.abs(py - y) < 8 ? { cursorStyle: 'ns-resize', externalId: this.id, zOrder: 'top' } : null;
    }
}
