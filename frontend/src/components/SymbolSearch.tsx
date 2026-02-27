import { useState, useEffect } from 'react';

interface SymbolSearchProps {
    onSelect: (symbol: string, type: string, source?: string) => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
    hideIcon?: boolean;
    inputClassName?: string;
    mode?: 'search' | 'add';
}

const POPULAR_CRYPTO = [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'XRPUSDT', baseAsset: 'XRP', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'ADAUSDT', baseAsset: 'ADA', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'DOGEUSDT', baseAsset: 'DOGE', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'AVAXUSDT', baseAsset: 'AVAX', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'DOTUSDT', baseAsset: 'DOT', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'MATICUSDT', baseAsset: 'MATIC', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'LINKUSDT', baseAsset: 'LINK', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'UNIUSDT', baseAsset: 'UNI', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'LTCUSDT', baseAsset: 'LTC', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'BCHUSDT', baseAsset: 'BCH', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'ATOMUSDT', baseAsset: 'ATOM', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'ETCUSDT', baseAsset: 'ETC', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'XLMUSDT', baseAsset: 'XLM', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'NEARUSDT', baseAsset: 'NEAR', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'ALGOUSDT', baseAsset: 'ALGO', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'VETUSDT', baseAsset: 'VET', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'ICPUSDT', baseAsset: 'ICP', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'FILUSDT', baseAsset: 'FIL', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'SANDUSDT', baseAsset: 'SAND', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'MANAUSDT', baseAsset: 'MANA', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'AAVEUSDT', baseAsset: 'AAVE', quoteAsset: 'USDT', source: 'Binance' },
    { symbol: 'XAUUSDT', baseAsset: 'XAU', quoteAsset: 'USDT', source: 'Binance Futures' },
    { symbol: 'XAGUSDT', baseAsset: 'XAG', quoteAsset: 'USDT', source: 'Binance Futures' },
];

const POPULAR_STOCKS = [
    { symbol: 'AAPL', name: 'Apple Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'TSLA', name: 'Tesla Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'GOOG', name: 'Alphabet Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'META', name: 'Meta Platforms Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'NFLX', name: 'Netflix Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'INTC', name: 'Intel Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'BA', name: 'Boeing Co.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'DIS', name: 'Walt Disney Co.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'JPM', name: 'JPMorgan Chase', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'V', name: 'Visa Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'WMT', name: 'Walmart Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'PG', name: 'Procter & Gamble', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'KO', name: 'Coca-Cola Co.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'PEP', name: 'PepsiCo Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'MCD', name: 'McDonald\'s Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'NKE', name: 'NIKE Inc.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'SBUX', name: 'Starbucks Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'XOM', name: 'Exxon Mobil Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'CVX', name: 'Chevron Corp.', type: 'EQUITY', source: 'Yahoo Finance' },
    { symbol: 'EURUSD=X', name: 'EUR/USD', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'GBPUSD=X', name: 'GBP/USD', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'USDJPY=X', name: 'USD/JPY', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'AUDUSD=X', name: 'AUD/USD', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'USDCAD=X', name: 'USD/CAD', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'USDCHF=X', name: 'USD/CHF', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'NZDUSD=X', name: 'NZD/USD', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'EURJPY=X', name: 'EUR/JPY', type: 'CURRENCY', source: 'Alpha Vantage' },
    { symbol: 'GBPJPY=X', name: 'GBP/JPY', type: 'CURRENCY', source: 'Alpha Vantage' },
];

export function SymbolSearch({ onSelect, placeholder = "Search symbol...", className = "w-48", autoFocus = false, hideIcon = false, inputClassName = "", mode = 'search' }: SymbolSearchProps) {
    const [query, setQuery] = useState('');
    const [assetType, setAssetType] = useState<'crypto' | 'stock'>('crypto');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [results, setResults] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [visibleCount, setVisibleCount] = useState(20);
    const [popularData, setPopularData] = useState<{ crypto: any[], stock: any[] }>({ crypto: POPULAR_CRYPTO, stock: POPULAR_STOCKS });

    useEffect(() => {
        fetch('http://localhost:8000/market/popular')
            .then(res => res.json())
            .then(data => {
                if (data.crypto && data.stock) {
                    setPopularData(prev => ({
                        crypto: data.crypto.length > 0 ? data.crypto : prev.crypto,
                        stock: data.stock.length > 0 ? data.stock : prev.stock
                    }));
                }
            })
            .catch(err => console.error("Failed to fetch popular assets:", err));
    }, []);

    useEffect(() => {
        let active = true;

        if (!query) {
            setResults(assetType === 'crypto' ? popularData.crypto : popularData.stock);
            setVisibleCount(20);
            setIsLoading(false);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            setVisibleCount(20);
            setIsLoading(true);
            try {
                const res = await fetch(`http://localhost:8000/market/search?query=${query}&asset_type=${assetType}&limit=50`);
                const data = await res.json();
                if (active) setResults(data);
            } catch (err) {
                console.error("Search error:", err);
                if (active) setResults([]);
            } finally {
                if (active) setIsLoading(false);
            }
        }, 300);

        return () => {
            active = false;
            clearTimeout(delayDebounceFn);
        };
    }, [query, assetType, popularData]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 50) {
            setVisibleCount(prev => Math.min(prev + 20, results.length));
        }
    };

    return (
        <div className={`relative flex flex-col h-full bg-[#1E222D] ${className}`}>

            {/* Asset Type Tabs */}
            <div className="flex border-b border-gray-800 p-2 gap-2 shrink-0">
                <button
                    className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${assetType === 'crypto' ? 'bg-[#2962FF] text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                    onClick={() => setAssetType('crypto')}
                >
                    Crypto
                </button>
                <button
                    className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${assetType === 'stock' ? 'bg-[#2962FF] text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                    onClick={() => setAssetType('stock')}
                >
                    Stocks & FX
                </button>
            </div>

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

            <div className="flex-1 overflow-y-auto w-full max-h-[400px]" onScroll={handleScroll}>
                {results.length > 0 ? results.slice(0, visibleCount).map((item, i) => (
                    <button
                        key={i}
                        className="w-full text-left px-4 py-3 border-b border-gray-800/50 hover:bg-[#2962FF]/10 text-sm transition-colors flex justify-between items-center group"
                        onClick={() => {
                            onSelect(item.symbol, assetType, item.source);
                            // Input clearing and closing happens via parent
                        }}
                    >
                        <div>
                            <span className="text-white font-bold group-hover:text-[#2962FF] transition-colors">{item.symbol}</span>
                            <span className="text-gray-500 text-[11px] ml-2 block sm:inline">
                                {item.baseAsset ? `${item.baseAsset} / ${item.quoteAsset}` : item.name || item.type}
                            </span>
                            {item.source && (
                                <span className="text-gray-500 text-[9px] ml-2 border border-gray-700 px-1 py-0.5 rounded bg-[#131722] uppercase tracking-wider">
                                    {item.source}
                                </span>
                            )}
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
