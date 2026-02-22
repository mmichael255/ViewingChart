import React, { useState } from 'react';

export interface IndicatorConfig {
    id: string;
    type: 'overlay' | 'oscillator';
    name: string;
    params: Record<string, unknown>;
}

export const availableIndicators: {
    overlay: { id: string, name: string, defaultParams: Record<string, unknown> }[],
    oscillator: { id: string, name: string, defaultParams: Record<string, unknown> }[]
} = {
    overlay: [
        { id: 'ma', name: 'MA', defaultParams: { periods: [7, 25, 99] } },
        { id: 'ema', name: 'EMA', defaultParams: { periods: [7, 25, 99] } },
        { id: 'boll', name: 'BOLL', defaultParams: { period: 20, multiplier: 2 } },
        { id: 'sar', name: 'SAR', defaultParams: { step: 0.02, maxStep: 0.2 } },
    ],
    oscillator: [
        { id: 'volume', name: 'VOLUME', defaultParams: {} },
        { id: 'macd', name: 'MACD', defaultParams: { fast: 12, slow: 26, signal: 9 } },
        { id: 'rsi', name: 'RSI', defaultParams: { period: 14 } },
        { id: 'kdj', name: 'KDJ', defaultParams: { n: 9, m1: 3, m2: 3 } },
    ]
};

interface IndicatorBarProps {
    activeIndicators: IndicatorConfig[];
    onChange: React.Dispatch<React.SetStateAction<IndicatorConfig[]>>;
}

export const IndicatorBar: React.FC<IndicatorBarProps> = ({ activeIndicators, onChange }) => {
    const [isOverlayMenuOpen, setIsOverlayMenuOpen] = useState(false);
    const [isAllIndicatorsModalOpen, setIsAllIndicatorsModalOpen] = useState(false);
    const [editingIndicator, setEditingIndicator] = useState<IndicatorConfig | null>(null);

    const toggleIndicator = (id: string, type: 'overlay' | 'oscillator', defaultParams: Record<string, unknown>) => {
        const isActive = activeIndicators.some(ind => ind.id === id);
        if (isActive) {
            onChange(prev => prev.filter(ind => ind.id !== id));
        } else {
            onChange(prev => [...prev, { id, type, name: availableIndicators[type].find(i => i.id === id)?.name || id, params: defaultParams }]);
        }
    };

    const handleSaveParams = (newParams: Record<string, unknown>) => {
        if (!editingIndicator) return;
        onChange(prev => prev.map(ind => ind.id === editingIndicator.id ? { ...ind, params: newParams } : ind));
        setEditingIndicator(null);
    };

    return (
        <>
            <div className="flex items-center bg-[#131722] text-gray-400 text-[10px] select-none overflow-x-auto scrollbar-none border-t border-gray-800 h-7 shrink-0 relative flex-wrap sm:flex-nowrap">
                <div className="indicator-list flex items-center px-1 w-full relative">
                    <ul className="main flex items-center gap-3 whitespace-nowrap mr-8">
                        {availableIndicators.overlay.map(ind => {
                            const isActive = activeIndicators.some(active => active.id === ind.id);
                            return (
                                <li
                                    key={ind.id}
                                    className={`cursor-pointer transition-colors ${isActive ? 'text-[#2962FF] font-bold' : 'hover:text-[#2962FF]'}`}
                                    onClick={() => toggleIndicator(ind.id, 'overlay', ind.defaultParams)}
                                >
                                    {ind.name}
                                </li>
                            );
                        })}

                        <div className="more-indicators relative inline-flex items-center ml-1">
                            <button
                                type="button"
                                className={`icon more hover:text-white transition-colors ${isOverlayMenuOpen ? 'text-white' : ''}`}
                                onClick={() => setIsOverlayMenuOpen(!isOverlayMenuOpen)}
                            >
                                <svg width="13" height="12" viewBox="0 0 13 12"><path d="M5 2l3.2929 3.2929c.3905.3905.3905 1.0237 0 1.4142L5 10" stroke="currentColor" fill="none" fillRule="evenodd" strokeLinecap="round"></path></svg>
                            </button>

                            {/* Overlay Indicators Menu */}
                            {isOverlayMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsOverlayMenuOpen(false)} />
                                    <div className="absolute top-full left-0 mt-2 bg-[#1E222D] border border-gray-700 rounded shadow-2xl p-2 z-50 min-w-[150px]">
                                        <div className="text-[10px] text-gray-500 font-bold px-2 py-1 mb-1 uppercase">Main Overlays</div>
                                        {availableIndicators.overlay.map(ind => {
                                            const isActive = activeIndicators.some(active => active.id === ind.id);
                                            return (
                                                <div
                                                    key={`menu-${ind.id}`}
                                                    className={`px-3 py-2 cursor-pointer rounded hover:bg-gray-700 flex justify-between items-center ${isActive ? 'text-[#2962FF]' : 'text-gray-300'}`}
                                                    onClick={() => {
                                                        toggleIndicator(ind.id, 'overlay', ind.defaultParams);
                                                        setIsOverlayMenuOpen(false);
                                                    }}
                                                >
                                                    <span className="font-bold">{ind.name}</span>
                                                    {isActive && <span>✓</span>}
                                                </div>
                                            );
                                        })}
                                        <div className="mt-2 text-[10px] text-gray-500 italic px-2">Space reserved for more indicators...</div>
                                    </div>
                                </>
                            )}
                        </div>
                    </ul>

                    <div className="w-px h-3 bg-gray-700 mx-2 shrink-0"></div>

                    <ul className="sub flex items-center gap-3 whitespace-nowrap hidden sm:flex">
                        {availableIndicators.oscillator.map(ind => {
                            const isActive = activeIndicators.some(active => active.id === ind.id);
                            return (
                                <li
                                    key={ind.id}
                                    className={`cursor-pointer transition-colors ${isActive ? 'text-[#2962FF] font-bold' : 'hover:text-[#2962FF]'}`}
                                    onClick={() => toggleIndicator(ind.id, 'oscillator', ind.defaultParams)}
                                >
                                    {ind.name}
                                </li>
                            );
                        })}
                    </ul>

                    <div className="flex-1"></div>

                    <button
                        type="button"
                        className="icon editor-indicator-btn ml-auto hover:text-white transition-colors p-1"
                        onClick={() => setIsAllIndicatorsModalOpen(true)}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16"><g fill="currentColor" fillRule="evenodd"><path d="M12.583 8h.917v5.5h-11v-11H8v.917H3.417v9.166h9.166z"></path><path fillRule="nonzero" d="M6.9096 8.353l6.1709-6.171.7714.7715-6.1709 6.171z"></path></g></svg>
                    </button>
                </div>
            </div>

            {/* Central Modal for All Indicators */}
            {isAllIndicatorsModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center backdrop-blur-sm" onClick={() => setIsAllIndicatorsModalOpen(false)}>
                    <div className="bg-[#1E222D] border border-gray-700 rounded-lg shadow-2xl w-[600px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-4 border-b border-gray-800 shrink-0">
                            <h3 className="text-white font-bold">Indicators Configuration</h3>
                            <button onClick={() => setIsAllIndicatorsModalOpen(false)} className="text-gray-400 hover:text-white transition-colors text-lg">✕</button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
                            <div>
                                <h4 className="text-sm font-bold text-gray-400 mb-3 border-b border-gray-800 pb-2">Main Chart Overlays</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    {availableIndicators.overlay.map(ind => {
                                        const isActive = activeIndicators.some(active => active.id === ind.id);
                                        const activeConfig = activeIndicators.find(active => active.id === ind.id);
                                        return (
                                            <div key={`modal-${ind.id}`} className="flex items-center gap-1">
                                                <button
                                                    className={`flex-1 flex items-center justify-between p-3 rounded text-left border ${isActive ? 'bg-[#2962FF]/10 border-[#2962FF] text-[#2962FF]' : 'bg-[#131722] border-gray-700 text-gray-300 hover:border-gray-500'}`}
                                                    onClick={() => toggleIndicator(ind.id, 'overlay', ind.defaultParams)}
                                                >
                                                    <span className="font-bold text-sm">{ind.name}</span>
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${isActive ? 'bg-[#2962FF] border-[#2962FF]' : 'border-gray-600'}`}>
                                                        {isActive && <span className="text-white text-xs leading-none">✓</span>}
                                                    </div>
                                                </button>
                                                {isActive && (
                                                    <button
                                                        onClick={() => setEditingIndicator(activeConfig!)}
                                                        className="p-3 border border-gray-700 rounded bg-[#131722] text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                                                        title={`Edit ${ind.name} Settings`}
                                                    >
                                                        ⚙️
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <div className="p-3 border border-dashed border-gray-700 rounded text-gray-500 text-xs flex items-center justify-center">Space for future indicators...</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-400 mb-3 border-b border-gray-800 pb-2">Sub-Chart Oscillators</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    {availableIndicators.oscillator.map(ind => {
                                        const isActive = activeIndicators.some(active => active.id === ind.id);
                                        const activeConfig = activeIndicators.find(active => active.id === ind.id);
                                        return (
                                            <div key={`modal-${ind.id}`} className="flex items-center gap-1">
                                                <button
                                                    className={`flex-1 flex items-center justify-between p-3 rounded text-left border ${isActive ? 'bg-[#2962FF]/10 border-[#2962FF] text-[#2962FF]' : 'bg-[#131722] border-gray-700 text-gray-300 hover:border-gray-500'}`}
                                                    onClick={() => toggleIndicator(ind.id, 'oscillator', ind.defaultParams)}
                                                >
                                                    <span className="font-bold text-sm">{ind.name}</span>
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${isActive ? 'bg-[#2962FF] border-[#2962FF]' : 'border-gray-600'}`}>
                                                        {isActive && <span className="text-white text-xs leading-none">✓</span>}
                                                    </div>
                                                </button>
                                                {isActive && ind.id !== 'volume' && (
                                                    <button
                                                        onClick={() => setEditingIndicator(activeConfig!)}
                                                        className="p-3 border border-gray-700 rounded bg-[#131722] text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                                                        title={`Edit ${ind.name} Settings`}
                                                    >
                                                        ⚙️
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <div className="p-3 border border-dashed border-gray-700 rounded text-gray-500 text-xs flex items-center justify-center">Space for future indicators...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Sub-Modal: Edit Indicator Parameters */}
            {editingIndicator && (
                <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center backdrop-blur-sm" onClick={() => setEditingIndicator(null)}>
                    <div className="bg-[#1E222D] border border-gray-700 rounded-lg shadow-2xl w-[320px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-4 border-b border-gray-800 shrink-0">
                            <h3 className="text-white font-bold">{editingIndicator.name} Settings</h3>
                            <button onClick={() => setEditingIndicator(null)} className="text-gray-400 hover:text-white transition-colors text-lg">✕</button>
                        </div>
                        <div className="p-4 flex flex-col gap-4">
                            {Object.entries(editingIndicator.params).map(([key, value]) => {
                                const typedValue = value as string | number | number[];
                                return (
                                    <div key={key} className="flex flex-col gap-1.5">
                                        <label className="text-xs font-bold text-gray-400 uppercase">{key}</label>
                                        <input
                                            type="text"
                                            defaultValue={Array.isArray(typedValue) ? typedValue.join(',') : typedValue.toString()}
                                            className="bg-[#131722] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#2962FF] transition-colors"
                                            onBlur={(e) => {
                                                const valStr = e.target.value.trim();
                                                const newParams = { ...editingIndicator.params };

                                                // Auto-detect array vs number based on existing type
                                                if (Array.isArray(editingIndicator.params[key])) {
                                                    const parts = valStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
                                                    if (parts.length > 0) newParams[key] = parts;
                                                } else {
                                                    const num = parseFloat(valStr);
                                                    if (!isNaN(num)) newParams[key] = num;
                                                }

                                                // Optimistically apply local state while editing
                                                setEditingIndicator({ ...editingIndicator, params: newParams });
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.currentTarget.blur();
                                                    handleSaveParams(editingIndicator.params);
                                                }
                                            }}
                                        />
                                        {Array.isArray(typedValue) && <span className="text-[10px] text-gray-500 italic">Comma separated values (e.g. 7, 25, 99)</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="p-4 border-t border-gray-800 flex justify-end gap-2 bg-[#131722]/50">
                            <button onClick={() => setEditingIndicator(null)} className="px-4 py-2 rounded text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">Cancel</button>
                            <button onClick={() => handleSaveParams(editingIndicator.params)} className="px-4 py-2 rounded text-sm font-bold text-white bg-[#2962FF] hover:bg-blue-500 transition-colors">Apply</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
