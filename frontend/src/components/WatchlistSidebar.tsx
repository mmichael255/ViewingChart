/* eslint-disable @typescript-eslint/no-explicit-any */
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
    const cryptoWatchlistRef = useRef(cryptoWatchlist);
    const stockWatchlistRef = useRef(stockWatchlist);
    useEffect(() => {
        cryptoWatchlistRef.current = cryptoWatchlist;
        stockWatchlistRef.current = stockWatchlist;
    });

    useEffect(() => {
        let timeoutId: number;
        let isActive = true;

        const fetchInitialTickers = async () => {
            try {
                const stocks = stockWatchlist.map(i => i.sym).join(',');
                const cryptos = cryptoWatchlist.map(i => i.sym).join(',');
                const res = await fetch(`${API_URL}/market/tickers?stock_symbols=${stocks}&crypto_symbols=${cryptos}`);
                const newData = await res.json();
                if (isActive) {
                    setTickers(prev => ({ ...prev, ...newData }));
                }
            } catch (err) {
                console.error("Failed to fetch initial tickers:", err);
            }

            const pollStocks = async () => {
                if (!isActive || stockWatchlist.length === 0) return;
                try {
                    const stocks = stockWatchlist.map(i => i.sym).join(',');
                    const res = await fetch(`${API_URL}/market/tickers?stock_symbols=${stocks}`);
                    const newData = await res.json();
                    if (isActive) {
                        setTickers(prev => ({ ...prev, ...newData }));
                    }
                } catch (err) {
                    console.error("Failed to fetch stock tickers:", err);
                } finally {
                    if (isActive) {
                        timeoutId = window.setTimeout(pollStocks, 10000);
                    }
                }
            };

            if (isActive) {
                timeoutId = window.setTimeout(pollStocks, 10000);
            }
        };

        fetchInitialTickers();

        return () => {
            isActive = false;
            window.clearTimeout(timeoutId);
        };
    }, [stockWatchlist, cryptoWatchlist]);

    // WebSocket sync for cryptos — Fix #3.4: exponential backoff
    useEffect(() => {
        let reconnectTimeout: ReturnType<typeof setTimeout>;
        let isUnmounted = false;
        let reconnectAttempt = 0;
        let pingTimeout: ReturnType<typeof setTimeout>;
        let tabHidden =
            typeof document !== 'undefined' && document.visibilityState === 'hidden';
        let lastHiddenAt = 0;

        function clearPingWatchdog() {
            clearTimeout(pingTimeout);
        }

        function armPingWatchdog() {
            clearPingWatchdog();
            if (tabHidden || isUnmounted) return;
            // Only enforced while tab is visible — background tabs throttle JS and WS delivery.
            pingTimeout = setTimeout(() => {
                if (tabHidden || isUnmounted) return;
                console.error(
                    '[Watchlist WS] Silent disconnect detected (no data for 60s while tab visible). Forcing reconnect...'
                );
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.close();
                }
            }, 60000);
        }

        async function refreshPricesFromRest() {
            if (isUnmounted) return;
            const stocks = stockWatchlistRef.current.map(i => i.sym).join(',');
            const cryptos = cryptoWatchlistRef.current.map(i => i.sym).join(',');
            if (!stocks && !cryptos) return;
            try {
                const res = await fetch(
                    `${API_URL}/market/tickers?stock_symbols=${stocks}&crypto_symbols=${cryptos}`
                );
                const newData = await res.json();
                if (!isUnmounted && newData && typeof newData === 'object') {
                    setTickers(prev => ({ ...prev, ...newData }));
                }
            } catch (err) {
                console.error('[Watchlist] REST refresh after idle failed:', err);
            }
        }

        function reconnectTickerWsSafely() {
            if (isUnmounted) return;
            const w = wsRef.current;
            if (w) {
                w.onclose = null;
                clearTimeout(reconnectTimeout);
                try {
                    w.close();
                } catch {
                    /* ignore */
                }
            }
            connectWS();
        }

        function onVisibilityChange() {
            if (document.visibilityState === 'hidden') {
                lastHiddenAt = Date.now();
                tabHidden = true;
                clearPingWatchdog();
                return;
            }
            tabHidden = false;
            armPingWatchdog();
            void refreshPricesFromRest();
            const awayMs = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
            // Ticker WS can stay OPEN but stop receiving (proxy / server); kline WS still works.
            if (lastHiddenAt && awayMs >= 30_000) {
                reconnectTickerWsSafely();
            } else if (wsRef.current?.readyState === WebSocket.CLOSED && !isUnmounted) {
                connectWS();
            }
        }

        function connectWS() {
            if (isUnmounted) return;

            const socket = new WebSocket(`${WS_URL}/market/ws/tickers`);
            wsRef.current = socket;

            socket.onopen = () => {
                console.info(`[Watchlist WS] Connected successfully to ${WS_URL}/market/ws/tickers`);
                reconnectAttempt = 0;
                armPingWatchdog();
                socket.send(JSON.stringify({
                    action: 'subscribe',
                    symbols: cryptoWatchlist.map(i => i.sym)
                }));
            };

            socket.onmessage = (event) => {
                armPingWatchdog();
                try {
                    const payload = JSON.parse(event.data);
                    if (payload && typeof payload === 'object' && payload.type === 'heartbeat') {
                        return;
                    }
                    if (payload && typeof payload === 'object') {
                        setTickers(prev => ({ ...prev, ...payload }));
                    }
                } catch (e) {
                    console.error('[Watchlist WS] Ticker JSON parsing error', e, 'Raw data:', event.data);
                }
            };

            socket.onerror = (err) => {
                console.error(`[Watchlist WS] Connection error:`, err);
            };

            socket.onclose = (event) => {
                clearPingWatchdog();

                if (!isUnmounted) {
                    const delay = Math.min(3000 * Math.pow(2, reconnectAttempt), 30000);
                    reconnectAttempt++;
                    console.warn(
                        `[Watchlist WS] Closed with code: ${event.code}, reason: ${event.reason}. Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempt})`
                    );
                    reconnectTimeout = setTimeout(connectWS, delay);
                } else {
                    console.info(`[Watchlist WS] Closed cleanly (component unmounted)`);
                }
            };
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
        connectWS();

        return () => {
            isUnmounted = true;
            clearTimeout(reconnectTimeout);
            clearPingWatchdog();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
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
