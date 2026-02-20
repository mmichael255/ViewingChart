import { useState, useEffect } from 'react';

interface SymbolSearchProps {
    onSelect: (symbol: string, type: string) => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
    hideIcon?: boolean;
    inputClassName?: string;
    mode?: 'search' | 'add';
}

export function SymbolSearch({ onSelect, placeholder = "Search crypto...", className = "w-48", autoFocus = false, hideIcon = false, inputClassName = "", mode = 'search' }: SymbolSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Record<string, string>[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`http://localhost:8000/market/search?query=${query}&asset_type=crypto&limit=50`);
                const data = await res.json();
                setResults(data);
            } catch (err) {
                console.error("Search error:", err);
            } finally {
                setIsLoading(false);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [query]);

    return (
        <div className={`relative flex flex-col h-full bg-[#1E222D] ${className}`}>
            <div className="relative shrink-0 p-4 border-b border-gray-800">
                {!hideIcon && (
                    <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
                        <span className="text-gray-400 text-xs text-[#2962FF]">🔍</span>
                    </div>
                )}
                <input
                    type="text"
                    value={query}
                    autoFocus={autoFocus}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    className={`w-full bg-[#131722] border border-gray-700 text-white focus:outline-none focus:border-[#2962FF] transition-colors placeholder-gray-500 pr-3 ${!hideIcon ? 'pl-8' : 'pl-4'} ${inputClassName || 'py-2 text-sm rounded'}`}
                />
                {isLoading && (
                    <div className="absolute right-6 top-6 w-4 h-4 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin" />
                )}
            </div>

            <div className="flex-1 overflow-y-auto w-full max-h-[400px]">
                {results.length > 0 ? results.map((item, i) => (
                    <button
                        key={i}
                        className="w-full text-left px-4 py-3 border-b border-gray-800/50 hover:bg-[#2962FF]/10 text-sm transition-colors flex justify-between items-center group"
                        onClick={() => {
                            onSelect(item.symbol, 'crypto');
                            // Input clearing and closing happens via parent
                        }}
                    >
                        <div>
                            <span className="text-white font-bold group-hover:text-[#2962FF] transition-colors">{item.symbol}</span>
                            <span className="text-gray-500 text-[11px] ml-2 block sm:inline">{item.baseAsset} / {item.quoteAsset}</span>
                        </div>
                        {mode === 'add' && (
                            <span className="text-gray-500 group-hover:text-[#2962FF] font-bold text-lg leading-none">+</span>
                        )}
                    </button>
                )) : query && !isLoading ? (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">
                        No results found for &quot;{query}&quot;
                    </div>
                ) : null}
            </div>
        </div>
    );
}
