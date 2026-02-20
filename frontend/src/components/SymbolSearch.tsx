import { useState, useEffect, useRef } from 'react';

interface SymbolSearchProps {
    onSelect: (symbol: string, type: string) => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
}

export function SymbolSearch({ onSelect, placeholder = "Search crypto...", className = "w-48", autoFocus = false }: SymbolSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Record<string, string>[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!query) {
            setResults([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`http://localhost:8000/market/search?query=${query}&asset_type=crypto`);
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
        <div ref={wrapperRef} className={`relative z-50 ${className}`}>
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-xs text-[#2962FF]">🔍</span>
                </div>
                <input
                    type="text"
                    value={query}
                    autoFocus={autoFocus}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    className="w-full bg-[#131722] border border-gray-700 rounded pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#2962FF] transition-colors placeholder-gray-500"
                />
                {isLoading && (
                    <div className="absolute right-2 top-2 w-3.5 h-3.5 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin" />
                )}
            </div>

            {isOpen && (query || results.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1E222D] border border-gray-700 rounded shadow-2xl max-h-64 overflow-y-auto">
                    {results.length > 0 ? results.map((item, i) => (
                        <button
                            key={i}
                            className="w-full text-left px-3 py-2 hover:bg-[#2962FF]/10 text-xs transition-colors flex justify-between items-center group"
                            onClick={() => {
                                onSelect(item.symbol, 'crypto');
                                setIsOpen(false);
                                setQuery('');
                            }}
                        >
                            <div>
                                <span className="text-white font-bold group-hover:text-[#2962FF] transition-colors">{item.symbol}</span>
                                <span className="text-gray-500 text-[10px] ml-2 block sm:inline">{item.baseAsset} / {item.quoteAsset}</span>
                            </div>
                        </button>
                    )) : query ? (
                        <div className="px-3 py-4 text-center text-gray-500 text-xs">
                            No results found for &quot;{query}&quot;
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
