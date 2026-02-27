"use client";

import { useEffect, useState, useRef } from 'react';
import { PriceHighlight } from './Highlighting';
import { NewsFeed } from './NewsFeed';
import { API_URL, WS_URL } from '@/config';
import type { WatchlistItem, TickerData } from '@/types/market';

interface WatchlistSidebarProps {
    cryptoWatchlist: WatchlistItem[];
    stockWatchlist: WatchlistItem[];
    symbol: string;
    handleSymbolChange: (newSymbol: string, type: string) => void;
    setSearchModalMode: (mode: 'closed' | 'search' | 'add') => void;
}

export function WatchlistSidebar({
    cryptoWatchlist,
    stockWatchlist,
    symbol,
    handleSymbolChange,
    setSearchModalMode
}: WatchlistSidebarProps) {
    const [tickers, setTickers] = useState<Record<string, any>>({});
    const wsRef = useRef<WebSocket | null>(null);

    // Data Fetching Logic (Recursive Timeout to prevent simple interval overlap)
    useEffect(() => {
        let timeoutId: number;
        let isActive = true;

        const fetchTickers = async () => {
            try {
                const cryptos = cryptoWatchlist.map(i => i.sym).join(',');
                const stocks = stockWatchlist.map(i => i.sym).join(',');
                const res = await fetch(`${API_URL}/market/tickers?crypto_symbols=${cryptos}&stock_symbols=${stocks}`);
                const newData = await res.json();
                if (isActive) {
                    setTickers(prev => ({ ...prev, ...newData }));
                }
            } catch (err) {
                console.error("Failed to fetch tickers:", err);
            } finally {
                if (isActive) {
                    timeoutId = window.setTimeout(fetchTickers, 10000);
                }
            }
        };

        fetchTickers();

        return () => {
            isActive = false;
            window.clearTimeout(timeoutId);
        };
    }, [cryptoWatchlist, stockWatchlist]);

    // WebSocket sync for cryptos
    useEffect(() => {
        let reconnectTimeout: ReturnType<typeof setTimeout>;
        let isUnmounted = false;

        const connectWS = () => {
            if (isUnmounted) return;

            const socket = new WebSocket(`${WS_URL}/market/ws/tickers`);
            wsRef.current = socket;

            socket.onopen = () => {
                socket.send(JSON.stringify({
                    action: 'subscribe',
                    symbols: cryptoWatchlist.map(i => i.sym)
                }));
            };

            socket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload && typeof payload === 'object') {
                        setTickers(prev => ({ ...prev, ...payload }));
                    }
                } catch (e) {
                    console.error("WS Ticker parsing error", e);
                }
            };

            socket.onclose = () => {
                if (!isUnmounted) {
                    console.log(`Watchlist WS closed. Reconnecting in 3 seconds...`);
                    reconnectTimeout = setTimeout(connectWS, 3000);
                }
            };
        };

        connectWS();

        return () => {
            isUnmounted = true;
            clearTimeout(reconnectTimeout);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Initialize once

    useEffect(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                action: 'subscribe',
                symbols: cryptoWatchlist.map(i => i.sym)
            }));
        }
    }, [cryptoWatchlist]);

    return (
        <aside className="w-[320px] shrink-0 flex flex-col border border-gray-800 bg-[#1E222D] overflow-hidden z-20 shadow-xl">
            <div className="flex flex-col h-full overflow-hidden">
                <div className="flex flex-col shrink-0 min-h-[400px] h-[50%] border-b border-gray-800 overflow-hidden relative">
                    <div className="px-4 py-4 border-b border-gray-800 flex justify-between items-center bg-[#1E222D]">
                        <span className="text-[13px] font-black text-gray-200 uppercase tracking-widest">Watchlist</span>
                        <button
                            onClick={() => setSearchModalMode('add')}
                            className="text-xs font-bold text-[#2962FF] hover:text-white bg-[#2962FF]/10 px-3 py-1.5 rounded transition-all flex items-center gap-1.5"
                        >
                            <span className="text-sm leading-none">＋</span> Add
                        </button>
                    </div>
                    <div className="grid grid-cols-12 px-4 py-1.5 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-gray-800/50 bg-[#1E222D]">
                        <div className="col-span-4">Symbol</div>
                        <div className="col-span-3 text-right">Last</div>
                        <div className="col-span-2 text-right">Chg</div>
                        <div className="col-span-3 text-right">Chg%</div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-800">
                        <WatchlistGroup
                            title="Crypto"
                            items={cryptoWatchlist}
                            tickers={tickers}
                            handleSymbolChange={handleSymbolChange}
                            symbol={symbol}
                            type="crypto"
                        />
                        <WatchlistGroup
                            title="Stocks & FX"
                            items={stockWatchlist}
                            tickers={tickers}
                            handleSymbolChange={handleSymbolChange}
                            symbol={symbol}
                            type="stock"
                        />
                    </div>
                </div>
                <div className="flex-1 flex flex-col bg-[#1E222D] overflow-hidden">
                    <NewsFeed compact />
                </div>
            </div>
        </aside>
    );
}

const WatchlistGroup = ({ title, items, tickers, handleSymbolChange, symbol, type }: any) => (
    <>
        <div className="px-3 py-1 mb-1 mt-2">
            <span className="text-[9px] font-black text-[#2962FF] uppercase tracking-widest">{title}</span>
        </div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {items.map(({ sym, label, sub, source }: any) => {
            const ticker = tickers[sym] || {};
            const isUp = (ticker.priceChange || 0) >= 0;
            const colorClass = isUp ? 'text-green-400' : 'text-red-400';
            return (
                <button
                    key={sym}
                    onClick={() => handleSymbolChange(sym, type)}
                    className={`w-full grid grid-cols-12 items-center px-3 py-2 rounded mb-0.5 transition-all outline-none group ${symbol === sym ? 'bg-[#2962FF]/10' : 'hover:bg-gray-800/40'}`}
                >
                    <div className="col-span-4 text-left">
                        <div className={`text-xs font-bold leading-none ${symbol === sym ? 'text-[#2962FF]' : 'text-gray-200 group-hover:text-white'}`}>{label}</div>
                        <div className="text-[8px] text-gray-500 font-medium truncate mt-0.5 flex items-center gap-1">
                            <span>{sub}</span>
                            {source && <span className="text-[7px] uppercase bg-gray-800 px-1 py-0.5 rounded text-gray-400 tracking-widest">{source}</span>}
                        </div>
                    </div>
                    <div className="col-span-3 text-right">
                        <PriceHighlight price={ticker.lastPrice || 0} className="text-[11px] font-bold" />
                    </div>
                    <div className={`col-span-2 text-right text-[10px] font-medium ${colorClass}`}>
                        {ticker.priceChange ? (ticker.priceChange > 0 ? '+' : '') + ticker.priceChange.toFixed(2) : '0.00'}
                    </div>
                    <div className={`col-span-3 text-right text-[10px] font-bold ${colorClass}`}>
                        {ticker.priceChangePercent ? (ticker.priceChangePercent > 0 ? '+' : '') + ticker.priceChangePercent.toFixed(2) + '%' : '0.00%'}
                    </div>
                </button>
            );
        })}
    </>
);
