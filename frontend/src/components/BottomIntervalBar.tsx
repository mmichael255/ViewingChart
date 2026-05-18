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
        <div className="flex items-center gap-1 bg-[#0D1117] border-t border-[#30363D] px-2 h-7 shrink-0 overflow-x-auto scrollbar-none">
            {intervals.map(int => (
                <button
                    key={int}
                    onClick={() => onIntervalChange(int)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${currentInterval === int
                        ? 'text-[#D1D5DB] bg-[#D1D5DB]/10'
                        : 'text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#30363D]'
                        }`}
                >
                    {int}
                </button>
            ))}
        </div>
    );
};
