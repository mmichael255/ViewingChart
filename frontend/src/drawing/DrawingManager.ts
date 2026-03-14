/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { DrawingToolType, DrawingPoint, DrawingStyle, DrawingObject } from './drawingTypes';
import { getClicksRequired, DEFAULT_DRAWING_STYLE } from './drawingTypes';

import { DrawingPrimitive } from './primitives/DrawingPrimitive';
import { TrendLinePrimitive } from './primitives/TrendLinePrimitive';
import { RayPrimitive } from './primitives/RayPrimitive';
import { HorizontalLinePrimitive } from './primitives/HorizontalLinePrimitive';
import { VerticalLinePrimitive } from './primitives/VerticalLinePrimitive';
import { FibRetracementPrimitive } from './primitives/FibRetracementPrimitive';
import { RectanglePrimitive } from './primitives/RectanglePrimitive';
import { MeasurePrimitive } from './primitives/MeasurePrimitive';
import { ParallelChannelPrimitive } from './primitives/ParallelChannelPrimitive';

const LS_KEY_PREFIX = 'vc_drawings_';

let _nextId = 1;
function generateId(): string {
    return `draw_${Date.now()}_${_nextId++}`;
}

export class DrawingManager {
    private _chart: IChartApi | null = null;
    private _series: ISeriesApi<any> | null = null;
    private _activeTool: DrawingToolType = 'crosshair';
    private _pendingPoints: DrawingPoint[] = [];
    private _drawings: Map<string, DrawingPrimitive> = new Map();
    private _selectedId: string | null = null;
    private _symbolKey: string = '';
    private _previewPrimitive: DrawingPrimitive | null = null;

    // Callbacks
    public onDrawingComplete?: (id: string) => void;
    public onSelectionChange?: (id: string | null) => void;
    public onToolReset?: () => void;

    // Drag State Trackers
    private _dragState: { id: string, part: 'body' | 'point', index?: number, lastPx: number, lastPy: number } | null = null;

    // ─── Setup ──────────────────────────────────────────────────

    attach(chart: IChartApi, series: ISeriesApi<any>): void {
        this._chart = chart;
        this._series = series;
    }

    detach(): void {
        this.cancelDrawing();
        this.clearAll();
        this._chart = null;
        this._series = null;
    }

    // ─── Tool Management ────────────────────────────────────────

    get activeTool(): DrawingToolType {
        return this._activeTool;
    }

    setTool(tool: DrawingToolType): void {
        // Cancel any in-progress drawing
        this.cancelDrawing();
        this._activeTool = tool;
        // Deselect when switching tool
        this.deselectAll();
    }

    // ─── Symbol Management ──────────────────────────────────────

    setSymbol(symbolKey: string): void {
        // Save current
        if (this._symbolKey) this.save();
        // Clear
        this.clearAttachedPrimitives();
        this._drawings.clear();
        this._symbolKey = symbolKey;
        // Load
        this.load();
    }

    // ─── Click Handling (called from chart click handler) ───────

    handleClick(point: DrawingPoint): void {
        if (this._activeTool === 'crosshair') {
            return; // handled by mousedown instead
        }

        const clicksNeeded = getClicksRequired(this._activeTool);
        if (clicksNeeded === 0) return; // crosshair, no drawing

        this._pendingPoints.push(point);

        if (this._pendingPoints.length === clicksNeeded) {
            // Complete the drawing
            this.finalizeDrawing(this._activeTool, [...this._pendingPoints]);
            this._pendingPoints = [];
            this.removePreview();
        } else {
            // Force an instant preview update for immediate visual feedback of the first click
            this.handleMouseMove(point);
        }
    }

    /** Called on mouse move during drawing placement to show preview */
    handleMouseMove(point: DrawingPoint): void {
        if (this._activeTool === 'crosshair') return;
        if (this._pendingPoints.length === 0) return;

        const clicksNeeded = getClicksRequired(this._activeTool);
        if (this._pendingPoints.length >= clicksNeeded) return;

        // Build preview points: existing pending + current mouse position
        const previewPoints = [...this._pendingPoints, point];

        // For 3-click tools with only 1 point placed, we need at least 2 for a preview
        if (this._activeTool === 'parallel_channel' && previewPoints.length < 2) return;

        this.updatePreview(this._activeTool, previewPoints);
    }

    // ─── Preview Drawing ───────────────────────────────────────

    private updatePreview(type: DrawingToolType, points: DrawingPoint[]): void {
        if (!this._series) return;

        // Remove old preview
        this.removePreview();

        // Create temporary preview primitive
        const style: DrawingStyle = { ...DEFAULT_DRAWING_STYLE, color: '#2962FF80' };
        this._previewPrimitive = this.createPrimitive('__preview', type, points, style);
        if (this._previewPrimitive) {
            this._previewPrimitive.setSelected(true); // Always show control points on preview
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._series.attachPrimitive(this._previewPrimitive as any);
        }
    }

    private removePreview(): void {
        if (this._previewPrimitive && this._series) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._series.detachPrimitive(this._previewPrimitive as any);
            this._previewPrimitive = null;
        }
    }

    // ─── Drawing Finalization ──────────────────────────────────

    private finalizeDrawing(type: DrawingToolType, points: DrawingPoint[]): void {
        if (!this._series) return;

        const id = generateId();
        const style: DrawingStyle = { ...DEFAULT_DRAWING_STYLE };
        const primitive = this.createPrimitive(id, type, points, style);
        if (!primitive) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._series.attachPrimitive(primitive as any);
        this._drawings.set(id, primitive);

        this.onDrawingComplete?.(id);
        this.save();
    }

    private createPrimitive(
        id: string,
        type: DrawingToolType,
        points: DrawingPoint[],
        style: DrawingStyle
    ): DrawingPrimitive | null {
        switch (type) {
            case 'trendline':
                return new TrendLinePrimitive(id, points, style);
            case 'ray':
                return new RayPrimitive(id, points, style);
            case 'horizontal_line':
                return new HorizontalLinePrimitive(id, points, style);
            case 'vertical_line':
                return new VerticalLinePrimitive(id, points, style);
            case 'fib_retracement':
                return new FibRetracementPrimitive(id, points, style);
            case 'rectangle':
                return new RectanglePrimitive(id, points, style);
            case 'measure':
                return new MeasurePrimitive(id, points, style);
            case 'parallel_channel':
                return new ParallelChannelPrimitive(id, points, style);
            default:
                return null;
        }
    }

    // ─── Selection ─────────────────────────────────────────────

    handleMouseDown(px: number, py: number): boolean {
        // First check the selected drawing to prefer dragging its control points
        if (this._selectedId) {
            const primitive = this._drawings.get(this._selectedId);
            if (primitive) {
                const hit = primitive.hitTestPart(px, py);
                if (hit) {
                    this._dragState = { id: this._selectedId, part: hit.part, index: hit.index, lastPx: px, lastPy: py };
                    return true;
                }
            }
        }

        // Then check all others
        for (const [id, primitive] of this._drawings) {
            if (id === this._selectedId) continue;
            const hit = primitive.hitTestPart(px, py);
            if (hit) {
                // select it and start dragging
                this.deselectAll();
                this._selectedId = id;
                primitive.setSelected(true);
                this.onSelectionChange?.(id);

                this._dragState = { id, part: hit.part, index: hit.index, lastPx: px, lastPy: py };
                return true;
            }
        }

        // Clicked empty space
        if (this._selectedId && this._activeTool === 'crosshair') {
            this.deselectAll();
            this.onSelectionChange?.(null);
        }
        return false;
    }

    handleDrag(px: number, py: number): boolean {
        if (!this._dragState) return false;

        const primitive = this._drawings.get(this._dragState.id);
        if (!primitive) {
            this._dragState = null;
            return false;
        }

        const dx = px - this._dragState.lastPx;
        const dy = py - this._dragState.lastPy;

        if (this._dragState.part === 'point' && this._dragState.index !== undefined) {
            primitive.applyPointDelta(this._dragState.index, dx, dy);
        } else {
            primitive.applyBodyDelta(dx, dy);
        }

        this._dragState.lastPx = px;
        this._dragState.lastPy = py;
        return true;
    }

    endDrag(): boolean {
        if (this._dragState) {
            this._dragState = null;
            this.save();
            return true;
        }
        return false;
    }

    deselectAll(): void {
        if (this._selectedId) {
            this._drawings.get(this._selectedId)?.setSelected(false);
        }
        this._selectedId = null;
    }

    get selectedId(): string | null {
        return this._selectedId;
    }

    getSelectedDrawing(): DrawingObject | null {
        if (!this._selectedId || !this._symbolKey) return null;
        const primitive = this._drawings.get(this._selectedId);
        if (!primitive) return null;
        return {
            id: primitive.id,
            type: this.getPrimitiveType(primitive),
            points: primitive.points,
            style: primitive.style,
            symbolKey: this._symbolKey,
        };
    }

    updateSelectedStyle(style: Partial<DrawingStyle>): void {
        if (!this._selectedId) return;
        const primitive = this._drawings.get(this._selectedId);
        if (primitive) {
            primitive.setStyle(style);
            this.save();
        }
    }

    // ─── Deletion ──────────────────────────────────────────────

    removeDrawing(id: string): void {
        const primitive = this._drawings.get(id);
        if (primitive && this._series) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._series.detachPrimitive(primitive as any);
            this._drawings.delete(id);
            if (this._selectedId === id) this._selectedId = null;
            this.save();
        }
    }

    removeSelected(): boolean {
        if (this._selectedId) {
            this.removeDrawing(this._selectedId);
            this.onSelectionChange?.(null);
            return true;
        }
        return false;
    }

    removeAll(): void {
        this.clearAttachedPrimitives();
        this._drawings.clear();
        this._selectedId = null;
        this.save();
        this.onSelectionChange?.(null);
    }

    cancelDrawing(): void {
        this._pendingPoints = [];
        this.removePreview();
    }

    get isDrawing(): boolean {
        return this._pendingPoints.length > 0;
    }

    get drawingCount(): number {
        return this._drawings.size;
    }

    // ─── Persistence ───────────────────────────────────────────

    private save(): void {
        if (!this._symbolKey) return;
        const objects: DrawingObject[] = [];
        for (const [, primitive] of this._drawings) {
            if (primitive.id.startsWith('__')) continue; // skip previews
            objects.push({
                id: primitive.id,
                type: this.getPrimitiveType(primitive),
                points: primitive.points,
                style: primitive.style,
                symbolKey: this._symbolKey,
            });
        }
        try {
            localStorage.setItem(LS_KEY_PREFIX + this._symbolKey, JSON.stringify(objects));
        } catch {
            // localStorage full — silently ignore
        }
    }

    private load(): void {
        if (!this._symbolKey || !this._series) return;
        try {
            const raw = localStorage.getItem(LS_KEY_PREFIX + this._symbolKey);
            if (!raw) return;
            const objects: DrawingObject[] = JSON.parse(raw);
            for (const obj of objects) {
                const primitive = this.createPrimitive(obj.id, obj.type, obj.points, obj.style);
                if (primitive) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this._series.attachPrimitive(primitive as any);
                    this._drawings.set(obj.id, primitive);
                }
            }
        } catch {
            // Corrupt data — ignore
        }
    }

    private getPrimitiveType(p: DrawingPrimitive): DrawingToolType {
        if (p instanceof TrendLinePrimitive) return 'trendline';
        if (p instanceof RayPrimitive) return 'ray';
        if (p instanceof HorizontalLinePrimitive) return 'horizontal_line';
        if (p instanceof VerticalLinePrimitive) return 'vertical_line';
        if (p instanceof FibRetracementPrimitive) return 'fib_retracement';
        if (p instanceof RectanglePrimitive) return 'rectangle';
        if (p instanceof MeasurePrimitive) return 'measure';
        if (p instanceof ParallelChannelPrimitive) return 'parallel_channel';
        return 'trendline';
    }

    // ─── Internal Cleanup ──────────────────────────────────────

    private clearAttachedPrimitives(): void {
        if (!this._series) return;
        for (const [, primitive] of this._drawings) {
            try { this._series.detachPrimitive(primitive as any); } catch { /* */ }
        }
        this.removePreview();
    }

    private clearAll(): void {
        this.clearAttachedPrimitives();
        this._drawings.clear();
        this._selectedId = null;
        this._pendingPoints = [];
    }
}
