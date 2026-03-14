import type { Time } from 'lightweight-charts';

// ─── Tool Types ───────────────────────────────────────────────
export type DrawingToolType =
    | 'crosshair'
    | 'trendline'
    | 'ray'
    | 'horizontal_line'
    | 'vertical_line'
    | 'parallel_channel'
    | 'fib_retracement'
    | 'rectangle'
    | 'measure';

// ─── Drawing Point (chart coordinates) ───────────────────────
export interface DrawingPoint {
    time: Time;
    price: number;
}

// ─── Drawing Style ───────────────────────────────────────────
export interface DrawingStyle {
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'dotted';
    fillColor?: string;
    fillOpacity?: number;
    showLabels?: boolean;
}

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
    color: '#2962FF',
    lineWidth: 2,
    lineStyle: 'solid',
    showLabels: true,
};

// ─── Drawing State Machine ───────────────────────────────────
export type DrawingState = 'idle' | 'placing' | 'complete';

// ─── Serializable Drawing Object ─────────────────────────────
export interface DrawingObject {
    id: string;
    type: DrawingToolType;
    points: DrawingPoint[];
    style: DrawingStyle;
    symbolKey: string;
}

// ─── Tool Definition (for toolbar UI) ────────────────────────
export interface ToolDefinition {
    type: DrawingToolType;
    icon: string;
    tooltip: string;
    /** Number of clicks required to complete the drawing */
    clicksRequired: number;
    /** Group name for toolbar submenu */
    group: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
    { type: 'crosshair', icon: '✜', tooltip: 'Crosshair', clicksRequired: 0, group: 'cursor' },
    { type: 'trendline', icon: '／', tooltip: 'Trend Line', clicksRequired: 2, group: 'lines' },
    { type: 'ray', icon: '↗', tooltip: 'Ray', clicksRequired: 2, group: 'lines' },
    { type: 'horizontal_line', icon: '─', tooltip: 'Horizontal Line', clicksRequired: 1, group: 'lines' },
    { type: 'vertical_line', icon: '│', tooltip: 'Vertical Line', clicksRequired: 1, group: 'lines' },
    { type: 'parallel_channel', icon: '⑃', tooltip: 'Parallel Channel', clicksRequired: 3, group: 'channels' },
    { type: 'fib_retracement', icon: '⊟', tooltip: 'Fib Retracement', clicksRequired: 2, group: 'fibonacci' },
    { type: 'rectangle', icon: '▭', tooltip: 'Rectangle', clicksRequired: 2, group: 'shapes' },
    { type: 'measure', icon: '📏', tooltip: 'Measure', clicksRequired: 2, group: 'measure' },
];

// ─── Helper: how many clicks does a tool need? ───────────────
export function getClicksRequired(type: DrawingToolType): number {
    return TOOL_DEFINITIONS.find(t => t.type === type)?.clicksRequired ?? 2;
}

// ─── Fibonacci levels ────────────────────────────────────────
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
export const FIB_COLORS: Record<number, string> = {
    0: '#787B86',
    0.236: '#F44336',
    0.382: '#FF9800',
    0.5: '#FFEB3B',
    0.618: '#4CAF50',
    0.786: '#00BCD4',
    1.0: '#787B86',
};
