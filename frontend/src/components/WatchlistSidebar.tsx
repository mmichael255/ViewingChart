"use client";

import React, { useEffect, useState, useRef } from 'react';
import { PriceHighlight } from './Highlighting';
import { NewsFeed } from './NewsFeed';
import { API_URL, websocketApiBase } from '@/config';
import type { TickerData, WatchlistItem } from '@/types/market';
import type { WsStatus } from '@/hooks/useMarketData';
import {
    MARKET_STALE_QUOTES_MS,
    RESYNC_AFTER_HIDDEN_MS,
    TRANSPORT_IDLE_TICKER_MS,
} from '@/lib/connectionResilience';
import { buildPrePostSegments, formatPrePostDelta } from '@/lib/prepost';

interface WatchlistSidebarProps {
    cryptoWatchlist: WatchlistItem[];
    stockWatchlist: WatchlistItem[];
    symbol: string;
    handleSymbolChange: (newSymbol: string, type: string) => void;
    setSearchModalMode: (mode: 'closed' | 'search' | 'add') => void;
    /**
     * Fires when the ticker for the currently displayed `symbol` changes
     * (by reference). Crypto WS frames that don't touch `symbol` won't fire
     * this — keeps the parent free from per-tick re-renders.
     */
    onSelectedTickerChange?: (ticker: TickerData | undefined) => void;
}

export function WatchlistSidebar({
    cryptoWatchlist,
    stockWatchlist,
    symbol,
    handleSymbolChange,
    setSearchModalMode,
    onSelectedTickerChange,
}: WatchlistSidebarProps) {
    const [tickers, setTickers] = useState<Record<string, TickerData>>({});
    const [tickerWsStatus, setTickerWsStatus] = useState<WsStatus>('disconnected');
    const wsRef = useRef<WebSocket | null>(null);
    const cryptoWatchlistRef = useRef(cryptoWatchlist);
    const stockWatchlistRef = useRef(stockWatchlist);
    useEffect(() => {
        cryptoWatchlistRef.current = cryptoWatchlist;
        stockWatchlistRef.current = stockWatchlist;
    });

    // Only push updates upward when the active symbol's ticker reference
    // actually changes — `setTickers({...prev, ...payload})` keeps the value
    // reference stable for symbols not in the payload, so React bails on
    // duplicate setState in the parent.
    const selectedTicker = tickers[symbol];
    useEffect(() => {
        onSelectedTickerChange?.(selectedTicker);
    }, [selectedTicker, onSelectedTickerChange]);

    useEffect(() => {
        let timeoutId: number;
        let isActive = true;

        const fetchInitialTickers = async () => {
            try {
                const stocks = stockWatchlist.map(i => i.sym).join(',');
                const cryptos = cryptoWatchlist.map(i => i.sym).join(',');
                const res = await fetch(
                    `${API_URL}/market/tickers?stock_symbols=${stocks}&crypto_symbols=${cryptos}`
                );
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
        /** Any frame including heartbeat (transport alive). */
        let transportTimeout: ReturnType<typeof setTimeout>;
        /** Non-heartbeat quote payload only. */
        let marketStaleTimeout: ReturnType<typeof setTimeout>;
        let tabHidden =
            typeof document !== 'undefined' && document.visibilityState === 'hidden';
        let lastHiddenAt = 0;

        function clearTransportWatchdog() {
            clearTimeout(transportTimeout);
        }

        function clearMarketStaleWatchdog() {
            clearTimeout(marketStaleTimeout);
        }

        function armTransportWatchdog() {
            clearTransportWatchdog();
            if (tabHidden || isUnmounted) return;
            transportTimeout = setTimeout(() => {
                if (tabHidden || isUnmounted) return;
                console.error(
                    `[Watchlist WS] Transport idle (no frame for ${TRANSPORT_IDLE_TICKER_MS / 1000}s while tab visible). Forcing reconnect...`
                );
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.close();
                }
            }, TRANSPORT_IDLE_TICKER_MS);
        }

        function armMarketStaleWatchdog() {
            clearMarketStaleWatchdog();
            if (tabHidden || isUnmounted) return;
            marketStaleTimeout = setTimeout(() => {
                if (tabHidden || isUnmounted) return;
                console.warn('[Watchlist WS] Market data stale (no quote for 45s). REST snapshot...');
                void refreshPricesFromRest();
            }, MARKET_STALE_QUOTES_MS);
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
                    armMarketStaleWatchdog();
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
                clearTransportWatchdog();
                clearMarketStaleWatchdog();
                return;
            }
            tabHidden = false;
            armTransportWatchdog();
            armMarketStaleWatchdog();
            void refreshPricesFromRest();
            const awayMs = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
            // Ticker WS can stay OPEN but stop receiving (proxy / server); kline WS still works.
            if (lastHiddenAt && awayMs >= RESYNC_AFTER_HIDDEN_MS) {
                reconnectTickerWsSafely();
            } else if (wsRef.current?.readyState === WebSocket.CLOSED && !isUnmounted) {
                connectWS();
            }
        }

        function connectWS() {
            if (isUnmounted) return;

            const wsBase = websocketApiBase();
            const socket = new WebSocket(`${wsBase}/market/ws/tickers`);
            wsRef.current = socket;

            socket.onopen = () => {
                const hadReconnect = reconnectAttempt > 0;
                console.info(`[Watchlist WS] Connected successfully to ${wsBase}/market/ws/tickers`);
                reconnectAttempt = 0;
                setTickerWsStatus('connected');
                armTransportWatchdog();
                armMarketStaleWatchdog();
                if (hadReconnect) {
                    void refreshPricesFromRest();
                }
                socket.send(JSON.stringify({
                    action: 'subscribe',
                    symbols: cryptoWatchlistRef.current.map(i => i.sym)
                }));
            };

            socket.onmessage = (event) => {
                armTransportWatchdog();
                try {
                    const payload = JSON.parse(event.data);
                    if (payload && typeof payload === 'object' && payload.type === 'heartbeat') {
                        return;
                    }
                    if (payload && typeof payload === 'object') {
                        armMarketStaleWatchdog();
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
                clearTransportWatchdog();
                clearMarketStaleWatchdog();

                if (!isUnmounted) {
                    setTickerWsStatus('reconnecting');
                    const delay = Math.min(3000 * Math.pow(2, reconnectAttempt), 30000);
                    reconnectAttempt++;
                    console.warn(
                        `[Watchlist WS] Closed with code: ${event.code}, reason: ${event.reason}. Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempt})`
                    );
                    reconnectTimeout = setTimeout(connectWS, delay);
                } else {
                    setTickerWsStatus('disconnected');
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
            clearTransportWatchdog();
            clearMarketStaleWatchdog();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
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
                        <span className="text-[13px] font-black text-gray-200 uppercase tracking-widest flex items-center gap-2">
                            Watchlist
                            <ConnectionDot status={tickerWsStatus} />
                        </span>
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

const ConnectionDot = ({ status }: { status: WsStatus }) => {
    const config = {
        connected: { color: 'bg-green-500', label: 'Connected' },
        reconnecting: { color: 'bg-yellow-500 animate-pulse', label: 'Reconnecting...' },
        disconnected: { color: 'bg-red-500', label: 'Disconnected' },
    }[status];

    return (
        <span title={config.label} className="relative flex h-2 w-2">
            {status === 'reconnecting' && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75 animate-ping" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${config.color}`} />
        </span>
    );
};

function StockPrePostSecondRow({ ticker }: { ticker: TickerData }) {
    const segments = buildPrePostSegments(ticker);
    if (segments.length === 0) return null;

    return (
        <div className="px-3 pb-2 -mt-0.5 text-[9px] leading-tight">
            {segments.map((seg) => {
                const labelClass = seg.isActiveSession
                    ? 'text-blue-300 font-black uppercase tracking-tight'
                    : 'text-gray-500 font-black uppercase tracking-tight';
                let deltaEl: React.ReactElement;
                if (seg.delta === null) {
                    deltaEl = <span className="text-gray-600"> —</span>;
                } else {
                    const colorClass = seg.delta >= 0 ? 'text-green-400' : 'text-red-400';
                    deltaEl = (
                        <span className={`tabular-nums font-medium ${colorClass}`}>
                            {formatPrePostDelta(seg)}
                        </span>
                    );
                }
                return (
                    <span
                        key={seg.kind}
                        className="inline-flex flex-wrap items-baseline gap-0.5 mr-3 last:mr-0"
                    >
                        <span className={labelClass}>{seg.label}</span>
                        <span className="text-gray-300 tabular-nums">{seg.price.toFixed(2)}</span>
                        {deltaEl}
                    </span>
                );
            })}
        </div>
    );
}

interface WatchlistGroupProps {
    title: string;
    items: WatchlistItem[];
    tickers: Record<string, TickerData>;
    handleSymbolChange: (newSymbol: string, type: string) => void;
    symbol: string;
    type: string;
}

const EMPTY_TICKER: TickerData = { lastPrice: 0, priceChange: 0, priceChangePercent: 0 };

const WatchlistGroup = ({ title, items, tickers, handleSymbolChange, symbol, type }: WatchlistGroupProps) => (
    <>
        <div className="px-3 py-1 mb-1 mt-2">
            <span className="text-[9px] font-black text-[#2962FF] uppercase tracking-widest">{title}</span>
        </div>
        {items.map(({ sym, label, sub, source }) => {
            const ticker: TickerData = tickers[sym] ?? EMPTY_TICKER;
            const isUp = ticker.priceChange >= 0;
            const colorClass = isUp ? 'text-green-400' : 'text-red-400';
            return (
                <button
                    key={sym}
                    onClick={() => handleSymbolChange(sym, type)}
                    className={`w-full block rounded mb-0.5 transition-all outline-none group text-left ${symbol === sym ? 'bg-[#2962FF]/10' : 'hover:bg-gray-800/40'}`}
                >
                    <div className="grid grid-cols-12 items-center px-3 py-2">
                        <div className="col-span-4 text-left">
                            <div className={`text-xs font-bold leading-none ${symbol === sym ? 'text-[#2962FF]' : 'text-gray-200 group-hover:text-white'}`}>{label}</div>
                            <div className="text-[8px] text-gray-500 font-medium truncate mt-0.5 flex items-center gap-1">
                                <span>{sub}</span>
                                {source && <span className="text-[7px] uppercase bg-gray-800 px-1 py-0.5 rounded text-gray-400 tracking-widest">{source}</span>}
                            </div>
                        </div>
                        <div className="col-span-3 text-right">
                            <PriceHighlight price={ticker.lastPrice} className="text-[11px] font-bold" />
                        </div>
                        <div className={`col-span-2 text-right text-[10px] font-medium ${colorClass}`}>
                            {ticker.priceChange ? (ticker.priceChange > 0 ? '+' : '') + ticker.priceChange.toFixed(2) : '0.00'}
                        </div>
                        <div className={`col-span-3 text-right text-[10px] font-bold ${colorClass}`}>
                            {ticker.priceChangePercent ? (ticker.priceChangePercent > 0 ? '+' : '') + ticker.priceChangePercent.toFixed(2) + '%' : '0.00%'}
                        </div>
                    </div>
                    {type === 'stock' && <StockPrePostSecondRow ticker={ticker} />}
                </button>
            );
        })}
    </>
);
