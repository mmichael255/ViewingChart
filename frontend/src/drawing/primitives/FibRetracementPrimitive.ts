import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';
import { FIB_LEVELS, FIB_COLORS } from '../drawingTypes';

// ─── Renderer ──────────────────────────────────────────────────
class FibRenderer implements IPrimitivePaneRenderer {
    private _levels: { y: number; price: number; ratio: number }[];
    private _x1: number;
    private _x2: number;
    private _selected: boolean;

    constructor(
        levels: { y: number; price: number; ratio: number }[],
        x1: number, x2: number,
        selected: boolean
    ) {
        this._levels = levels;
        this._x1 = x1;
        this._x2 = x2;
        this._selected = selected;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            const w = mediaSize.width;

            // Shaded regions between levels
            for (let i = 0; i < this._levels.length - 1; i++) {
                const top = this._levels[i];
                const bottom = this._levels[i + 1];
                const color = FIB_COLORS[top.ratio] || '#787B86';
                ctx.fillStyle = color + '15';
                ctx.fillRect(0, top.y, w, bottom.y - top.y);
            }

            // Draw level lines + labels
            for (const level of this._levels) {
                const color = FIB_COLORS[level.ratio] || '#787B86';

                ctx.beginPath();
                ctx.moveTo(0, level.y);
                ctx.lineTo(w, level.y);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.font = '11px Inter, sans-serif';
                ctx.fillStyle = color;
                ctx.textAlign = 'left';
                ctx.fillText(
                    `${(level.ratio * 100).toFixed(1)}% — ${level.price.toFixed(2)}`,
                    8,
                    level.y - 4
                );
            }

            // Vertical anchor lines
            if (this._levels.length > 0) {
                const topY = this._levels[0].y;
                const botY = this._levels[this._levels.length - 1].y;
                ctx.beginPath();
                ctx.moveTo(this._x1, topY);
                ctx.lineTo(this._x1, botY);
                ctx.strokeStyle = '#787B8640';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(this._x2, topY);
                ctx.lineTo(this._x2, botY);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            if (this._selected && this._levels.length >= 2) {
                DrawingPrimitive.drawControlPoint(ctx, this._x1, this._levels[0].y, '#787B86');
                DrawingPrimitive.drawControlPoint(ctx, this._x2, this._levels[this._levels.length - 1].y, '#787B86');
            }
        });
    }
}

// ─── View ──────────────────────────────────────────────────────
class FibPaneView implements IPrimitivePaneView {
    private _renderer: FibRenderer | null = null;
    private _primitive: FibRetracementPrimitive;

    constructor(primitive: FibRetracementPrimitive) {
        this._primitive = primitive;
    }

    update(): void {
        const points = this._primitive.points;
        if (points.length < 2) { this._renderer = null; return; }

        const x1 = this._primitive['timeToX'](points[0].time);
        const x2 = this._primitive['timeToX'](points[1].time);
        if (x1 === null || x2 === null) { this._renderer = null; return; }

        const high = Math.max(points[0].price, points[1].price);
        const low = Math.min(points[0].price, points[1].price);
        const range = high - low;

        const levels: { y: number; price: number; ratio: number }[] = [];
        for (const ratio of FIB_LEVELS) {
            const price = high - range * ratio;
            const y = this._primitive['priceToY'](price);
            if (y !== null) {
                levels.push({ y, price, ratio });
            }
        }

        this._renderer = new FibRenderer(levels, x1, x2, this._primitive.selected);
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }

    zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }
}

// ─── Primitive ─────────────────────────────────────────────────
export class FibRetracementPrimitive extends DrawingPrimitive {
    private _paneView: FibPaneView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, style);
        this._paneView = new FibPaneView(this);
    }

    updateAllViews(): void {
        this._paneView.update();
    }

    paneViews(): IPrimitivePaneView[] {
        return [this._paneView];
    }

    hitTest(_px: number, py: number): PrimitiveHoveredItem | null {
        const points = this._points;
        if (points.length < 2) return null;
        const high = Math.max(points[0].price, points[1].price);
        const low = Math.min(points[0].price, points[1].price);

        for (const ratio of FIB_LEVELS) {
            const price = high - (high - low) * ratio;
            const y = this.priceToY(price);
            if (y !== null && Math.abs(py - y) < 6) return { cursorStyle: 'pointer', externalId: this.id, zOrder: 'top' };
        }
        return null;
    }
}
