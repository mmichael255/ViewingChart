"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { PriceHighlight } from './Highlighting';
import { SymbolDetailPanel } from './SymbolDetailPanel';
import { API_URL, websocketApiBase } from '@/config';
import type { KlineData, TickerData, WatchlistItem } from '@/types/market';
import type { WsStatus } from '@/hooks/useMarketData';
import { formatCountdownMs, useCountdownMs } from '@/hooks/useCountdown';
import {
    MARKET_STALE_QUOTES_MS,
    RESYNC_AFTER_HIDDEN_MS,
    TRANSPORT_IDLE_TICKER_MS,
} from '@/lib/connectionResilience';
import { buildPrePostSegments, formatPrePostDelta } from '@/lib/prepost';
import { getAccessToken } from '@/lib/auth';
import { useResizable } from '@/hooks/useResizable';
import { ResizeHandle } from '@/components/ResizeHandle';

export interface WatchlistSummary {
    id: number;
    name: string;
    is_default: boolean;
}

interface WatchlistSidebarProps {
    watchlists?: WatchlistSummary[];
    selectedWatchlistId?: number | null;
    onSelectWatchlist?: (id: number) => void;
    onCreateWatchlist?: (name: string) => void;
    onRenameWatchlist?: (name: string) => void;
    onDeleteWatchlist?: () => void;
    onRemoveItem?: (sym: string, assetType: string) => void;
    orderedItems?: WatchlistItem[];
    onReorderItems?: (itemIds: number[]) => Promise<void> | void;
    onCopyItemToWatchlist?: (itemId: number, destWatchlistId: number) => Promise<void> | void;
    cryptoWatchlist: WatchlistItem[];
    stockWatchlist: WatchlistItem[];
    symbol: string;
    assetType: string;
    chartInterval: string;
    /** Chart klines at current interval (same as main chart) */
    chartKlines?: KlineData[];
    chartKlinesLoading?: boolean;
    /** Merged ticker for active symbol (watchlist WS/poll + parent extra fetch) */
    mergedTicker?: TickerData;
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
    watchlists,
    selectedWatchlistId,
    onSelectWatchlist,
    onCreateWatchlist,
    onRenameWatchlist,
    onDeleteWatchlist,
    onRemoveItem,
    orderedItems,
    onReorderItems,
    onCopyItemToWatchlist,
    cryptoWatchlist,
    stockWatchlist,
    symbol,
    assetType,
    chartInterval,
    chartKlines,
    chartKlinesLoading,
    mergedTicker,
    handleSymbolChange,
    setSearchModalMode,
    onSelectedTickerChange,
}: WatchlistSidebarProps) {
    const [tickers, setTickers] = useState<Record<string, TickerData>>({});
    const [tickerWsStatus, setTickerWsStatus] = useState<WsStatus>('disconnected');
    const wsRef = useRef<WebSocket | null>(null);
    const selectedWatchlistIdRef = useRef<number | null>(selectedWatchlistId ?? null);
    const [nextStockPollAtMs, setNextStockPollAtMs] = useState<number | null>(null);
    const [stockPollError, setStockPollError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editItems, setEditItems] = useState<WatchlistItem[]>([]);
    const [editSnapshotItems, setEditSnapshotItems] = useState<WatchlistItem[]>([]);
    const [copyPickerForId, setCopyPickerForId] = useState<number | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showRenameForm, setShowRenameForm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [formName, setFormName] = useState('');
    const cryptoWatchlistRef = useRef(cryptoWatchlist);
    const stockWatchlistRef = useRef(stockWatchlist);
    useEffect(() => {
        cryptoWatchlistRef.current = cryptoWatchlist;
        stockWatchlistRef.current = stockWatchlist;
        selectedWatchlistIdRef.current = selectedWatchlistId ?? null;
    });

    useEffect(() => {
        setIsEditing(false);
        setCopyPickerForId(null);
        setEditSnapshotItems([]);
        setShowCreateForm(false);
        setShowRenameForm(false);
        setShowDeleteConfirm(false);
        setFormName('');
    }, [selectedWatchlistId]);

    function snapshotItemsForEdit(): WatchlistItem[] {
        const src =
            orderedItems && orderedItems.length > 0
                ? orderedItems
                : [...cryptoWatchlist, ...stockWatchlist];
        return src.map((x) => ({ ...x }));
    }

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
        const POLL_MS = 10_000;

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
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    const newData = await res.json();
                    if (isActive) {
                        setTickers(prev => ({ ...prev, ...newData }));
                        setStockPollError(null);
                        // Only reset countdown on successful fetch.
                        setNextStockPollAtMs(Date.now() + POLL_MS);
                    }
                } catch (err) {
                    console.error("Failed to fetch stock tickers:", err);
                    if (isActive) setStockPollError((err as Error)?.message ?? 'fetch failed');
                } finally {
                    if (isActive) {
                        timeoutId = window.setTimeout(pollStocks, POLL_MS);
                    }
                }
            };

            if (isActive) {
                timeoutId = window.setTimeout(pollStocks, POLL_MS);
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
            const token = getAccessToken();
            const url = token
                ? `${wsBase}/market/ws/tickers?token=${encodeURIComponent(token)}`
                : `${wsBase}/market/ws/tickers`;
            const socket = new WebSocket(url);
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
                const tokenNow = getAccessToken();
                const wlId = selectedWatchlistIdRef.current;
                if (tokenNow && wlId) {
                    socket.send(JSON.stringify({ action: 'subscribe', watchlistId: wlId }));
                } else {
                    socket.send(JSON.stringify({
                        action: 'subscribe',
                        symbols: cryptoWatchlistRef.current.map(i => i.sym)
                    }));
                }
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
            const tokenNow = getAccessToken();
            if (tokenNow && selectedWatchlistId) {
                wsRef.current.send(JSON.stringify({ action: 'subscribe', watchlistId: selectedWatchlistId }));
            } else {
                wsRef.current.send(JSON.stringify({
                    action: 'subscribe',
                    symbols: cryptoWatchlist.map(i => i.sym)
                }));
            }
        }
    }, [cryptoWatchlist, selectedWatchlistId]);

    const watchlistMeta = useMemo(() => {
        const all = [...cryptoWatchlist, ...stockWatchlist];
        return all.find((i) => i.sym === symbol) ?? null;
    }, [symbol, cryptoWatchlist, stockWatchlist]);

    const { size: watchlistHeight, isDragging: isDetailDragging, handleProps: detailHandleProps } = useResizable({
        initialSize: 400,
        minSize: 200,
        maxSize: 800,
        direction: 'vertical',
    });

    const stockPollRemainingMs = useCountdownMs(stockWatchlist.length > 0 ? nextStockPollAtMs : null);
    const stockPollLabel = stockWatchlist.length > 0 && nextStockPollAtMs ? formatCountdownMs(stockPollRemainingMs) : null;

    // No longer derive pinned close from the active chart; we prefer the batch-fetched daily close map.

    return (
        <aside className="w-full h-full shrink-0 flex flex-col border border-[#30363D] bg-black overflow-hidden z-20 shadow-xl">
            <div className="flex flex-col h-full overflow-hidden">
                <div className="flex flex-col shrink-0 overflow-hidden relative" style={{ height: watchlistHeight, minHeight: 200 }}>
                    <div className="px-4 py-4 border-b border-[#30363D] flex justify-between items-start bg-black">
                        <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-sm font-black text-[#E6EDF3] uppercase tracking-widest flex items-center gap-2">
                                Watchlist
                                <ConnectionDot status={tickerWsStatus} />
                            </span>
                            {stockPollLabel && (
                                <span className="text-xs font-bold text-[#6E7681] uppercase tracking-widest">
                                    Stock refresh in <span className="tabular-nums text-[#8B949E]">{stockPollLabel}</span>
                                </span>
                            )}
                            {stockWatchlist.length > 0 && stockPollError && (
                                <span className="text-xs font-bold text-red-300 uppercase tracking-widest" title={stockPollError}>
                                    Stock quote fetch failed
                                </span>
                            )}
                            {watchlists && watchlists.length > 0 && (
                                <div className="mt-4 flex items-center gap-1.5 whitespace-nowrap">
                                    <select
                                        value={String(selectedWatchlistId ?? watchlists[0].id)}
                                        onChange={(e) => onSelectWatchlist?.(Number(e.target.value))}
                                        className="bg-black border border-[#21262D] rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#D1D5DB] max-w-[150px] truncate"
                                    >
                                        {watchlists.map((w) => (
                                            <option key={w.id} value={String(w.id)}>
                                                {w.is_default ? "★ " : ""}
                                                {w.name}
                                            </option>
                                        ))}
                                    </select>
                                    {isEditing && (
                                        <>
                                            <button
                                                onClick={() => { setFormName(''); setShowCreateForm(true); }}
                                                className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/40 hover:bg-[#30363D] rounded px-1.5 py-1 transition-colors"
                                                title="New list"
                                            >
                                                New
                                            </button>
                                            <button
                                                onClick={() => { const cur = watchlists?.find(w => w.id === selectedWatchlistId); setFormName(cur?.name ?? ''); setShowRenameForm(true); }}
                                                className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/40 hover:bg-[#30363D] rounded px-1.5 py-1 transition-colors"
                                                title="Rename list"
                                            >
                                                Rename
                                            </button>
                                            <button
                                                onClick={() => setShowDeleteConfirm(true)}
                                                className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/40 hover:bg-[#30363D] rounded px-1.5 py-1 transition-colors"
                                                title="Delete list"
                                            >
                                                Del
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                            {showCreateForm && (
                                <div className="mt-2 flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={formName}
                                        onChange={e => setFormName(e.target.value)}
                                        placeholder="Watchlist name"
                                        className="bg-black border border-[#21262D] rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#D1D5DB] flex-1 min-w-0"
                                        autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter' && formName.trim()) { onCreateWatchlist?.(formName.trim()); setShowCreateForm(false); setFormName(''); } if (e.key === 'Escape') { setShowCreateForm(false); setFormName(''); } }}
                                    />
                                    <button
                                        onClick={() => { if (formName.trim()) { onCreateWatchlist?.(formName.trim()); setShowCreateForm(false); setFormName(''); } }}
                                        className="text-xs font-black uppercase tracking-widest text-[#D1D5DB] hover:text-white bg-[#D1D5DB]/10 hover:bg-[#D1D5DB]/20 rounded px-2 py-1 transition-colors"
                                    >
                                        Create
                                    </button>
                                    <button
                                        onClick={() => { setShowCreateForm(false); setFormName(''); }}
                                        className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/30 hover:bg-[#30363D] rounded px-2 py-1 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                            {showRenameForm && (
                                <div className="mt-2 flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={formName}
                                        onChange={e => setFormName(e.target.value)}
                                        placeholder="Watchlist name"
                                        className="bg-black border border-[#21262D] rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#D1D5DB] flex-1 min-w-0"
                                        autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter' && formName.trim()) { onRenameWatchlist?.(formName.trim()); setShowRenameForm(false); setFormName(''); } if (e.key === 'Escape') { setShowRenameForm(false); setFormName(''); } }}
                                    />
                                    <button
                                        onClick={() => { if (formName.trim()) { onRenameWatchlist?.(formName.trim()); setShowRenameForm(false); setFormName(''); } }}
                                        className="text-xs font-black uppercase tracking-widest text-[#D1D5DB] hover:text-white bg-[#D1D5DB]/10 hover:bg-[#D1D5DB]/20 rounded px-2 py-1 transition-colors"
                                    >
                                        Rename
                                    </button>
                                    <button
                                        onClick={() => { setShowRenameForm(false); setFormName(''); }}
                                        className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/30 hover:bg-[#30363D] rounded px-2 py-1 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                            {showDeleteConfirm && (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-xs font-bold text-[#8B949E] uppercase tracking-widest">Delete this list?</span>
                                    <button
                                        onClick={() => { onDeleteWatchlist?.(); setShowDeleteConfirm(false); }}
                                        className="text-xs font-black uppercase tracking-widest text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded px-2 py-1 transition-colors"
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/30 hover:bg-[#30363D] rounded px-2 py-1 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => setSearchModalMode('add')}
                            className="mt-[1px] text-xs font-bold text-[#D1D5DB] hover:text-white bg-[#D1D5DB]/10 px-3 py-1.5 rounded transition-all flex items-center gap-1.5"
                        >
                            <span className="text-sm leading-none">＋</span> Add
                        </button>
                    </div>
                    <div className="grid grid-cols-12 px-4 py-1.5 text-[11px] font-black text-[#6E7681] uppercase tracking-widest border-b border-[#30363D]/50 bg-black">
                        <div className="col-span-4">Symbol</div>
                        <div className="col-span-3 text-right">Last</div>
                        <div className="col-span-2 text-right">Chg</div>
                        <div className="col-span-3 text-right">Chg%</div>
                    </div>
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-800 min-h-0">
                            {isEditing ? (
                                <EditableWatchlist
                                    items={editItems}
                                    watchlists={watchlists}
                                    selectedWatchlistId={selectedWatchlistId ?? null}
                                    copyPickerForId={copyPickerForId}
                                    setCopyPickerForId={setCopyPickerForId}
                                    onMove={(from, to) => {
                                        setEditItems((prev) => {
                                            const next = prev.slice();
                                            const [moved] = next.splice(from, 1);
                                            next.splice(to, 0, moved);
                                            return next;
                                        });
                                    }}
                                    onCopy={async (itemId, destId) => {
                                        if (!onCopyItemToWatchlist) return;
                                        await onCopyItemToWatchlist(itemId, destId);
                                        setCopyPickerForId(null);
                                    }}
                                    onRemoveItem={onRemoveItem}
                                />
                            ) : (
                                <>
                                    {orderedItems && orderedItems.length > 0 ? (
                                        <MixedWatchlist
                                            items={orderedItems}
                                            tickers={tickers}
                                            handleSymbolChange={handleSymbolChange}
                                            symbol={symbol}
                                        />
                                    ) : (
                                        <>
                                            <WatchlistGroup
                                                items={cryptoWatchlist}
                                                tickers={tickers}
                                                handleSymbolChange={handleSymbolChange}
                                                symbol={symbol}
                                                type="crypto"
                                            />
                                            <WatchlistGroup
                                                items={stockWatchlist}
                                                tickers={tickers}
                                                handleSymbolChange={handleSymbolChange}
                                                symbol={symbol}
                                                type="stock"
                                            />
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                        {onReorderItems && (
                            <div className="shrink-0 flex justify-end px-3 py-2 border-t border-[#30363D]/80 bg-black">
                                <div className="flex items-center gap-2">
                                    {isEditing && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCopyPickerForId(null);
                                                if (editSnapshotItems.length > 0) {
                                                    setEditItems(editSnapshotItems.map((x) => ({ ...x })));
                                                }
                                            }}
                                            className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/30 hover:bg-[#30363D]/60 border border-[#30363D] rounded px-3 py-1.5 transition-colors"
                                            title="Reset to pre-edit order"
                                        >
                                            Reset
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (!isEditing) {
                                                setCopyPickerForId(null);
                                                const snap = snapshotItemsForEdit();
                                                setEditSnapshotItems(snap);
                                                setEditItems(snap.map((x) => ({ ...x })));
                                                setIsEditing(true);
                                                return;
                                            }
                                            setCopyPickerForId(null);
                                            const ids = editItems.map((i) => i.id).filter((x): x is number => typeof x === 'number');
                                            if (ids.length !== editItems.length) {
                                                setIsEditing(false);
                                                return;
                                            }
                                            await onReorderItems(ids);
                                            setIsEditing(false);
                                        }}
                                        className="text-xs font-black uppercase tracking-widest text-[#8B949E] hover:text-[#E6EDF3] bg-[#30363D]/50 hover:bg-[#30363D] border border-[#30363D] rounded px-3 py-1.5 transition-colors"
                                        title={isEditing ? "Save order and exit" : "Reorder symbols and manage lists"}
                                    >
                                        {isEditing ? "Done" : "Edit"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <ResizeHandle direction="vertical" isDragging={isDetailDragging} {...detailHandleProps} />

                <div className="flex-1 flex flex-col bg-black overflow-hidden min-h-0">
                    <SymbolDetailPanel
                        symbol={symbol}
                        assetType={assetType}
                        chartInterval={chartInterval}
                        ticker={mergedTicker}
                        klines={chartKlines}
                        klinesLoading={chartKlinesLoading}
                        watchlistMeta={watchlistMeta}
                    />
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
    items: WatchlistItem[];
    tickers: Record<string, TickerData>;
    handleSymbolChange: (newSymbol: string, type: string) => void;
    symbol: string;
    type: string;
}

const EMPTY_TICKER: TickerData = { lastPrice: 0, priceChange: 0, priceChangePercent: 0 };

function displayLastForStock(t: TickerData): number {
    // Match Yahoo-style UX: always show the quote's current `lastPrice`,
    // which backend pins to pre/post/overnight depending on session.
    // (Watchlist baseline/deltas are still shown separately in the 2nd row.)
    return t.lastPrice;
}

const WatchlistGroup = ({ items, tickers, handleSymbolChange, symbol, type }: WatchlistGroupProps) => (
    <>
        {items.map(({ sym, label, sub, source }) => {
            const ticker: TickerData = tickers[sym] ?? EMPTY_TICKER;
            const shownLast = type === 'stock' ? displayLastForStock(ticker) : ticker.lastPrice;
            const isUp = ticker.priceChange >= 0;
            const colorClass = isUp ? 'text-green-400' : 'text-red-400';
            return (
                <button
                    key={sym}
                    onClick={() => handleSymbolChange(sym, type)}
                    className={`w-full block rounded mb-0.5 transition-all outline-none group text-left border-l-2 ${symbol === sym ? 'bg-[#D1D5DB]/10 border-[#D1D5DB]' : 'hover:bg-[#30363D]/70 border-transparent'}`}
                >
                    <div className="grid grid-cols-12 items-center px-3 py-2.5">
                        <div className="col-span-4 text-left">
                            <div className="flex items-center gap-2">
                                <div className={`text-sm font-bold leading-none ${symbol === sym ? 'text-[#D1D5DB]' : 'text-[#E6EDF3] group-hover:text-white'}`}>{label}</div>
                            </div>
                            <div className="text-[9px] text-[#6E7681] font-medium truncate mt-0.5 flex items-center gap-1">
                                <span>{sub}</span>
                                {source && <span className="text-[8px] uppercase bg-[#30363D] px-1 py-0.5 rounded text-[#8B949E] tracking-widest">{source}</span>}
                            </div>
                        </div>
                        <div className="col-span-3 text-right">
                            <PriceHighlight price={shownLast} className="text-xs font-bold" />
                        </div>
                        <div className={`col-span-2 text-right text-xs font-medium ${colorClass}`}>
                            {ticker.priceChange ? (ticker.priceChange > 0 ? '+' : '') + ticker.priceChange.toFixed(2) : '0.00'}
                        </div>
                        <div className={`col-span-3 text-right text-xs font-bold ${colorClass}`}>
                            {ticker.priceChangePercent ? (ticker.priceChangePercent > 0 ? '+' : '') + ticker.priceChangePercent.toFixed(2) + '%' : '0.00%'}
                        </div>
                    </div>
                    {type === 'stock' && <StockPrePostSecondRow ticker={ticker} />}
                </button>
            );
        })}
    </>
);

function MixedWatchlist({
    items,
    tickers,
    handleSymbolChange,
    symbol,
}: {
    items: WatchlistItem[];
    tickers: Record<string, TickerData>;
    handleSymbolChange: (newSymbol: string, type: string) => void;
    symbol: string;
}) {
    return (
        <>
            {items.map(({ id, sym, label, sub, source, asset_type }) => {
                const type = asset_type ?? 'crypto';
                const ticker: TickerData = tickers[sym] ?? EMPTY_TICKER;
                const shownLast = type === 'stock' ? displayLastForStock(ticker) : ticker.lastPrice;
                const isUp = ticker.priceChange >= 0;
                const colorClass = isUp ? 'text-green-400' : 'text-red-400';
                return (
                    <button
                        key={String(id ?? sym)}
                        onClick={() => handleSymbolChange(sym, type)}
                        className={`w-full block rounded mb-0.5 transition-all outline-none group text-left border-l-2 ${symbol === sym ? 'bg-[#D1D5DB]/10 border-[#D1D5DB]' : 'hover:bg-[#30363D]/70 border-transparent'}`}
                    >
                        <div className="grid grid-cols-12 items-center px-3 py-2.5">
                            <div className="col-span-4 text-left">
                                <div className="flex items-center gap-2">
                                    <div className={`text-sm font-bold leading-none ${symbol === sym ? 'text-[#D1D5DB]' : 'text-[#E6EDF3] group-hover:text-white'}`}>{label}</div>
                                    {type === 'stock' && (
                                        <span className="text-[8px] font-black uppercase tracking-widest bg-black/40 border border-[#30363D] rounded px-1 py-0.5 text-[#8B949E]">
                                            STK
                                        </span>
                                    )}
                                    </div>
                                <div className="text-[9px] text-[#6E7681] font-medium truncate mt-0.5 flex items-center gap-1">
                                    <span>{sub}</span>
                                    {source && <span className="text-[8px] uppercase bg-[#30363D] px-1 py-0.5 rounded text-[#8B949E] tracking-widest">{source}</span>}
                                </div>
                            </div>
                            <div className="col-span-3 text-right">
                                <PriceHighlight price={shownLast} className="text-xs font-bold" />
                            </div>
                            <div className={`col-span-2 text-right text-xs font-medium ${colorClass}`}>
                                {ticker.priceChange ? (ticker.priceChange > 0 ? '+' : '') + ticker.priceChange.toFixed(2) : '0.00'}
                            </div>
                            <div className={`col-span-3 text-right text-xs font-bold ${colorClass}`}>
                                {ticker.priceChangePercent ? (ticker.priceChangePercent > 0 ? '+' : '') + ticker.priceChangePercent.toFixed(2) + '%' : '0.00%'}
                            </div>
                        </div>
                        {type === 'stock' && <StockPrePostSecondRow ticker={ticker} />}
                    </button>
                );
            })}
        </>
    );
}

function EditableWatchlist({
    items,
    watchlists,
    selectedWatchlistId,
    copyPickerForId,
    setCopyPickerForId,
    onMove,
    onCopy,
    onRemoveItem,
}: {
    items: WatchlistItem[];
    watchlists?: WatchlistSummary[];
    selectedWatchlistId: number | null;
    copyPickerForId: number | null;
    setCopyPickerForId: (id: number | null) => void;
    onMove: (fromIndex: number, toIndex: number) => void;
    onCopy: (itemId: number, destWatchlistId: number) => Promise<void> | void;
    onRemoveItem?: (sym: string, assetType: string) => void;
}) {
    const destOptions = (watchlists ?? []).filter((w) => w.id !== selectedWatchlistId);

    return (
        <div className="px-1">
            {items.map((i, idx) => {
                const id = i.id;
                const canMoveUp = idx > 0;
                const canMoveDown = idx < items.length - 1;
                const canCopy = typeof id === 'number' && destOptions.length > 0;
                const isPickerOpen = typeof id === 'number' && copyPickerForId === id;
                const badge = i.asset_type === 'stock' ? 'STK' : i.asset_type === 'crypto' ? 'CRY' : null;

                return (
                    <div
                        key={`${i.sym}-${i.asset_type ?? ''}-${id ?? idx}`}
                        className="relative flex items-center gap-2 px-3 py-2.5 rounded mb-0.5 bg-[#30363D]/30 hover:bg-[#30363D]/50 transition-colors"
                    >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="text-sm font-bold text-[#E6EDF3] truncate">{i.label ?? i.sym}</div>
                            {badge && (
                                <span className="text-[8px] font-black uppercase tracking-widest bg-black/40 border border-[#30363D] rounded px-1 py-0.5 text-[#8B949E]">
                                    {badge}
                                </span>
                            )}
                            <div className="text-xs text-[#6E7681] font-medium truncate">{i.sub}</div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            {onRemoveItem && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemoveItem(i.sym, i.asset_type ?? 'crypto');
                                    }}
                                    className="text-xs font-black uppercase tracking-widest text-[#6E7681] hover:text-red-300 bg-black/30 hover:bg-red-500/10 border border-[#30363D] hover:border-red-500/30 rounded px-1.5 py-1 transition-colors"
                                    title="Remove from watchlist"
                                >
                                    ✕
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={!canMoveUp}
                                onClick={() => canMoveUp && onMove(idx, idx - 1)}
                                className={`text-xs font-black uppercase tracking-widest border rounded px-1.5 py-1 transition-colors ${
                                    canMoveUp
                                        ? 'text-[#8B949E] hover:text-[#E6EDF3] bg-black/30 hover:bg-black/60 border-[#30363D]'
                                        : 'text-[#30363D] bg-black/20 border-[#0D1117]/20 cursor-not-allowed'
                                }`}
                                title="Move up"
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                disabled={!canMoveDown}
                                onClick={() => canMoveDown && onMove(idx, idx + 1)}
                                className={`text-xs font-black uppercase tracking-widest border rounded px-1.5 py-1 transition-colors ${
                                    canMoveDown
                                        ? 'text-[#8B949E] hover:text-[#E6EDF3] bg-black/30 hover:bg-black/60 border-[#30363D]'
                                        : 'text-[#30363D] bg-black/20 border-[#0D1117]/20 cursor-not-allowed'
                                }`}
                                title="Move down"
                            >
                                ↓
                            </button>

                            <button
                                type="button"
                                disabled={!canCopy}
                                onClick={() => {
                                    if (!canCopy) return;
                                    setCopyPickerForId(isPickerOpen ? null : (id as number));
                                }}
                                className={`text-xs font-black uppercase tracking-widest border rounded px-2 py-1 transition-colors ${
                                    canCopy
                                        ? 'text-[#D1D5DB] hover:text-white bg-[#D1D5DB]/10 hover:bg-[#D1D5DB]/20 border-[#D1D5DB]/20'
                                        : 'text-[#30363D] bg-black/20 border-[#0D1117]/20 cursor-not-allowed'
                                }`}
                                title="Add to another watchlist"
                            >
                                +
                            </button>

                            {isPickerOpen && (
                                <div className="absolute right-3 top-full mt-1 z-50 bg-black border border-[#21262D] rounded shadow-2xl overflow-hidden min-w-[170px]">
                                    <div className="px-2 py-1 text-xs font-black uppercase tracking-widest text-[#6E7681] border-b border-[#30363D]">
                                        Add to…
                                    </div>
                                    {destOptions.map((w) => (
                                        <button
                                            key={w.id}
                                            type="button"
                                            onClick={() => typeof id === 'number' && onCopy(id, w.id)}
                                            className="w-full text-left px-2 py-2 text-xs text-[#E6EDF3] hover:bg-[#30363D]/60 transition-colors"
                                        >
                                            {w.is_default ? '★ ' : ''}
                                            {w.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
