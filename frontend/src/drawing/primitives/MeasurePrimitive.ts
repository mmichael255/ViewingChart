import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneView, IPrimitivePaneRenderer, PrimitivePaneViewZOrder, PrimitiveHoveredItem } from 'lightweight-charts';
import { DrawingPrimitive } from './DrawingPrimitive';

// ─── Renderer ──────────────────────────────────────────────────
class MeasureRenderer implements IPrimitivePaneRenderer {
    private _x1: number;
    private _y1: number;
    private _x2: number;
    private _y2: number;
    private _priceDelta: number;
    private _pctChange: number;
    private _barCount: number;

    constructor(
        x1: number, y1: number, x2: number, y2: number,
        priceDelta: number, pctChange: number, barCount: number,
    ) {
        this._x1 = x1; this._y1 = y1;
        this._x2 = x2; this._y2 = y2;
        this._priceDelta = priceDelta;
        this._pctChange = pctChange;
        this._barCount = barCount;
    }

    draw(target: CanvasRenderingTarget2D): void {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
            const isUp = this._priceDelta >= 0;
            const mainColor = isUp ? '#26a69a' : '#ef5350';

            // Shaded region
            const x = Math.min(this._x1, this._x2);
            const y = Math.min(this._y1, this._y2);
            const w = Math.abs(this._x2 - this._x1);
            const h = Math.abs(this._y2 - this._y1);
            ctx.fillStyle = mainColor + '18';
            ctx.fillRect(x, y, w, h);

            // Border
            ctx.strokeStyle = mainColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);

            // Info label box
            const labelX = Math.max(this._x1, this._x2) + 8;
            const labelY = Math.min(this._y1, this._y2);
            const sign = isUp ? '+' : '';
            const lines = [
                `${sign}${this._priceDelta.toFixed(2)}`,
                `${sign}${this._pctChange.toFixed(2)}%`,
                `${this._barCount} bars`,
            ];

            ctx.font = 'bold 11px Inter, sans-serif';
            const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
            const boxW = maxW + 16;
            const boxH = lines.length * 18 + 12;

            ctx.fillStyle = '#1E222DEE';
            ctx.strokeStyle = mainColor + '80';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(labelX, labelY, boxW, boxH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = mainColor;
            ctx.textAlign = 'left';
            lines.forEach((line, i) => {
                ctx.fillText(line, labelX + 8, labelY + 18 + i * 18);
            });
        });
    }
}

// ─── View ──────────────────────────────────────────────────────
class MeasurePaneView implements IPrimitivePaneView {
    private _renderer: MeasureRenderer | null = null;
    private _primitive: MeasurePrimitive;

    constructor(primitive: MeasurePrimitive) {
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

        const priceDelta = points[1].price - points[0].price;
        const pctChange = points[0].price !== 0 ? (priceDelta / points[0].price) * 100 : 0;

        const t1 = typeof points[0].time === 'number' ? points[0].time : 0;
        const t2 = typeof points[1].time === 'number' ? points[1].time : 0;
        const barCount = Math.abs(t2 - t1) > 0 ? Math.round(Math.abs(t2 - t1) / 86400) : 0;

        this._renderer = new MeasureRenderer(x1, y1, x2, y2, priceDelta, pctChange, barCount);
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this._renderer;
    }

    zOrder(): PrimitivePaneViewZOrder {
        return 'top';
    }
}

// ─── Primitive ─────────────────────────────────────────────────
export class MeasurePrimitive extends DrawingPrimitive {
    private _paneView: MeasurePaneView;

    constructor(id: string, points: DrawingPrimitive['_points'], style: DrawingPrimitive['_style']) {
        super(id, points, style);
        this._paneView = new MeasurePaneView(this);
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

        return (px >= left - 4 && px <= right + 4 && py >= top - 4 && py <= bottom + 4)
            ? { cursorStyle: 'pointer', externalId: this.id, zOrder: 'top' }
            : null;
    }
}
