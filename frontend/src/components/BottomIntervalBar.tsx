"use client";

import React from 'react';

interface BottomIntervalBarProps {
    intervals: string[];
    currentInterval: string;
    onIntervalChange: (interval: string) => void;
}

export const BottomIntervalBar: React.FC<BottomIntervalBarProps> = ({
    intervals,
    currentInterval,
    onIntervalChange
}) => {
    return (
        <div className="flex items-center gap-1 bg-[#131722] border-t border-gray-800 px-2 h-7 shrink-0 overflow-x-auto scrollbar-none">
            {intervals.map(int => (
                <button
                    key={int}
                    onClick={() => onIntervalChange(int)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${currentInterval === int
                        ? 'text-[#2962FF] bg-[#2962FF]/10'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                        }`}
                >
                    {int}
                </button>
            ))}
        </div>
    );
};
