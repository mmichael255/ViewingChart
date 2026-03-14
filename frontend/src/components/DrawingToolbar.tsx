import React from 'react';
import type { DrawingObject, DrawingStyle } from '@/drawing';

interface DrawingToolbarProps {
    drawing: DrawingObject;
    onUpdateStyle: (style: Partial<DrawingStyle>) => void;
    onDelete: () => void;
}

const COLORS = [
    '#2962FF', // Blue
    '#00C853', // Green
    '#FF6D00', // Orange
    '#E91E63', // Pink
    '#FFEB3B', // Yellow
    '#FFFFFF', // White
    '#787B86', // Gray
];

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({ drawing, onUpdateStyle, onDelete }) => {
    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1E222D] border border-gray-700 rounded shadow-2xl flex items-center gap-1 p-1.5 z-50 pointer-events-auto">
            {/* Colors */}
            <div className="flex items-center gap-1 pr-2 border-r border-gray-700">
                {COLORS.map(c => (
                    <button
                        key={c}
                        onClick={() => onUpdateStyle({ color: c })}
                        className={`w-5 h-5 rounded border-2 transition-transform hover:scale-110 ${drawing.style.color === c ? 'border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                    />
                ))}
            </div>

            {/* Line Width */}
            <div className="flex items-center gap-1 px-2 border-r border-gray-700">
                {[1, 2, 3, 4].map(w => (
                    <button
                        key={w}
                        onClick={() => onUpdateStyle({ lineWidth: w })}
                        className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${drawing.style.lineWidth === w ? 'bg-[#2962FF]/20 text-[#2962FF]' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                        title={`Line Width: ${w}px`}
                    >
                        <span className="block bg-current rounded-full" style={{ width: 12, height: w }} />
                    </button>
                ))}
            </div>

            {/* Line Style */}
            <div className="flex items-center gap-1 px-2 border-r border-gray-700">
                {(['solid', 'dashed', 'dotted'] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => onUpdateStyle({ lineStyle: s })}
                        className={`w-8 h-6 flex items-center justify-center rounded text-xs px-1 transition-colors ${drawing.style.lineStyle === s ? 'bg-[#2962FF]/20 text-[#2962FF] font-bold' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                        title={`Style: ${s}`}
                    >
                        {s === 'solid' && '—'}
                        {s === 'dashed' && '- -'}
                        {s === 'dotted' && '••'}
                    </button>
                ))}
            </div>

            {/* Delete */}
            <div className="pl-1">
                <button
                    onClick={onDelete}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    title="Delete"
                >
                    🗑
                </button>
            </div>
        </div>
    );
}
