"use client";

import { ChartComponent } from '@/components/ChartComponent';
import { PriceHighlight } from '@/components/Highlighting';
import { IndicatorBar, IndicatorConfig } from '@/components/IndicatorBar';
import { BottomIntervalBar } from '@/components/BottomIntervalBar';
import { useMarketData } from '@/hooks/useMarketData';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { CandlestickData, Time } from 'lightweight-charts';
import type { TickerData } from '@/types/market';
import { WatchlistSidebar } from '@/components/WatchlistSidebar';
import { SymbolSearch } from '@/components/SymbolSearch'; // New
import type { DrawingToolType } from '@/drawing';
import Link from 'next/link';
import { API_URL } from '@/config';
import { buildPrePostSegments } from '@/lib/prepost';

const INITIAL_CRYPTO_WATCHLIST = [
  { sym: 'BTCUSDT', label: 'BTC', sub: 'Bitcoin', source: 'Binance' },
  { sym: 'ETHUSDT', label: 'ETH', sub: 'Ethereum', source: 'Binance' },
  { sym: 'SOLUSDT', label: 'SOL', sub: 'Solana', source: 'Binance' },
  { sym: 'XAUUSDT', label: 'XAU', sub: 'Gold', source: 'Binance Futures' },
  { sym: 'XAGUSDT', label: 'XAG', sub: 'Silver', source: 'Binance Futures' },
];

const STOCK_WATCHLIST = [
  { sym: 'NVDA', label: 'NVDA', sub: 'NVIDIA', source: 'Yahoo Finance' },
  { sym: 'GOOG', label: 'GOOG', sub: 'Alphabet Inc.', source: 'Yahoo Finance' },
  { sym: 'TSLA', label: 'TSLA', sub: 'Tesla Inc.', source: 'Yahoo Finance' },
  { sym: 'AAPL', label: 'AAPL', sub: 'Apple Inc.', source: 'Yahoo Finance' },
];

const sessionLabel: Record<string, string> = {
  pre: 'Pre',
  regular: 'Regular',
  post: 'Post',
  overnight: 'Overnight',
  closed: 'Closed',
};

function formatEtTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

export default function Home() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [chartInterval, setChartInterval] = useState('1d');
  const [assetType, setAssetType] = useState('crypto');

  const [cryptoWatchlist, setCryptoWatchlist] = useState(INITIAL_CRYPTO_WATCHLIST);
  const [stockWatchlist, setStockWatchlist] = useState(STOCK_WATCHLIST);
  const [searchModalMode, setSearchModalMode] = useState<'closed' | 'search' | 'add'>('closed');
  // Two ticker sources for the active symbol:
  //   - watchlistTicker:    pushed up by <WatchlistSidebar> when symbol is in its map.
  //   - extraTickerBySymbol: one-shot REST fetches keyed by symbol, used when the
  //                         active symbol is NOT in the watchlist (so the chart-bar
  //                         Pre/Post still has data). Keyed (rather than reset on
  //                         symbol change) so a back-and-forth doesn't refetch.
  // We split watchlist vs. extra so per-tick crypto WS frames don't trigger a
  // setState here.
  const [watchlistTicker, setWatchlistTicker] = useState<TickerData | undefined>(undefined);
  const [extraTickerBySymbol, setExtraTickerBySymbol] = useState<Record<string, TickerData>>({});

  // Drawing Tools State
  const [activeTool, setActiveTool] = useState<DrawingToolType>('crosshair');

  // Indicators State
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([
    { id: 'ma', type: 'overlay', name: 'MA', params: { periods: [7, 25, 99] } },
    { id: 'volume', type: 'oscillator', name: 'VOLUME', params: {} }
  ]);

  // Quick Access Intervals
  // Default: 15m, 1h, 4h, 1d, 1w
  const [quickIntervals, setQuickIntervals] = useState(['15m', '1h', '4h', '1d', '1w']);
  const [showAllIntervals, setShowAllIntervals] = useState(false);
  const intervalDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (intervalDropdownRef.current && !intervalDropdownRef.current.contains(event.target as Node)) {
        setShowAllIntervals(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data, isLoading, wsStatus } = useMarketData(symbol, chartInterval, assetType);
  const extraTicker = extraTickerBySymbol[symbol];
  const selectedTicker = watchlistTicker ?? extraTicker;

  const handleSelectedTickerChange = useCallback((ticker: TickerData | undefined) => {
    setWatchlistTicker(ticker);
  }, []);

  // One-shot REST fetch for stock tickers the sidebar doesn't know about
  // (e.g. user searched a symbol not in the watchlist). The sidebar takes over
  // refresh once it starts polling the symbol; this just seeds the chart-bar
  // Pre/Post in the meantime.
  useEffect(() => {
    if (assetType !== 'stock' || !symbol) return;
    if (watchlistTicker) return; // sidebar has it
    if (extraTickerBySymbol[symbol]) return; // already fetched once
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/market/tickers?stock_symbols=${encodeURIComponent(symbol)}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, TickerData>;
        const t = data?.[symbol];
        if (t) setExtraTickerBySymbol((prev) => ({ ...prev, [symbol]: t }));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.debug('[page] ticker fetch failed', err);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [assetType, symbol, watchlistTicker, extraTickerBySymbol]);

  /** Same last bar as the chart / kline stream (REST + WS merged in useMarketData). */
  const lastClose = useMemo(() => {
    if (!data?.length) return null;
    const c = data[data.length - 1].close;
    const n = typeof c === 'number' ? c : Number(c);
    return Number.isFinite(n) ? n : null;
  }, [data]);

  useEffect(() => {
    if (lastClose != null) {
      document.title = `${lastClose.toFixed(2)} · ${symbol} · ViewingChart`;
    } else {
      document.title = 'ViewingChart';
    }
  }, [lastClose, symbol]);

  const handleSymbolChange = (newSymbol: string, type: string) => {
    setSymbol(newSymbol);
    setAssetType(type);
    if (type !== assetType) {
      setChartInterval(type === 'crypto' ? '1d' : '1h');
    }
  };

  const handleIntervalChange = (newInterval: string) => {
    setChartInterval(newInterval);
    setShowAllIntervals(false);
  };

  // --- Interval Interaction Logic ---
  const handleQuickDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("text/plain", index.toString());
    e.dataTransfer.effectAllowed = "move";
  };

  const handleQuickDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndexStr = e.dataTransfer.getData("text/plain");
    const sourceIndex = parseInt(sourceIndexStr, 10);

    if (!isNaN(sourceIndex) && sourceIndex !== targetIndex) {
      const newItems = [...quickIntervals];
      const [movedItem] = newItems.splice(sourceIndex, 1);
      newItems.splice(targetIndex, 0, movedItem);
      setQuickIntervals(newItems);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const toggleQuickAccess = (interval: string, e: React.MouseEvent) => {
    e.stopPropagation(); // prevent setting interval

    const exists = quickIntervals.includes(interval);
    if (exists) {
      if (quickIntervals.length > 3) {
        setQuickIntervals(prev => prev.filter(i => i !== interval));
      }
    } else {
      if (quickIntervals.length < 5) {
        setQuickIntervals(prev => [...prev, interval]);
      }
    }
  };

  const CRYPTO_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  // Stock candles always render RTH only (intraday is filtered upstream;
  // daily+ is naturally RTH from yfinance). 4h is aggregated from 1h on the
  // backend (`stock_service._aggregate_candles`).
  const STOCK_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
  const allIntervals = assetType === 'crypto' ? CRYPTO_INTERVALS : STOCK_INTERVALS;

  const prePostSegments = useMemo(
    () => (assetType === 'stock' ? buildPrePostSegments(selectedTicker) : []),
    [assetType, selectedTicker],
  );

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#131722] text-white overflow-hidden">
      {/* ── Global Header ── */}
      <header className="flex items-center justify-between px-5 h-12 border-b border-gray-800 bg-[#1E222D] shrink-0 z-40 relative">
        <div className="flex items-center gap-2 w-1/4">
          <span className="text-white font-bold text-lg tracking-tight">ViewingChart</span>
        </div>

        <div className="flex-1 flex justify-center w-2/4">
          <button
            onClick={() => setSearchModalMode('search')}
            className="w-72 bg-[#131722] border border-gray-700 text-white placeholder-gray-500 py-2 text-sm rounded-full text-left pl-4 hover:border-[#2962FF] transition-colors flex items-center"
          >
            <span className="text-gray-500">Search</span>
          </button>
        </div>

        <div className="flex items-center gap-3 justify-end w-1/4">
          <Link
            href="/monitor"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Connection monitor"
          >
            Monitor
          </Link>
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400 cursor-pointer hover:bg-gray-600">👤</div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden h-full gap-1 p-1">
        {/* ── Main Chart Wrapper ── */}
        <main className="flex-1 flex h-full overflow-hidden relative border border-gray-800 bg-[#1E222D]">
          {/* LEFT Drawing Toolbar */}
          <div className="w-10 flex flex-col items-center border-r border-gray-800 bg-[#1E222D] py-2 gap-2 z-30 shrink-0">
            <ToolIcon icon="✜" tooltip="Crosshair" isActive={activeTool === 'crosshair'} onClick={() => setActiveTool('crosshair')} />
            <ToolIcon icon="／" tooltip="Trend Line" isActive={activeTool === 'trendline'} onClick={() => setActiveTool(activeTool === 'trendline' ? 'crosshair' : 'trendline')} />
            <ToolIcon icon="—" tooltip="Horizontal Line" isActive={activeTool === 'horizontal_line'} onClick={() => setActiveTool(activeTool === 'horizontal_line' ? 'crosshair' : 'horizontal_line')} />
            <ToolIcon icon="|" tooltip="Vertical Line" isActive={activeTool === 'vertical_line'} onClick={() => setActiveTool(activeTool === 'vertical_line' ? 'crosshair' : 'vertical_line')} />
            <ToolIcon icon="↗" tooltip="Ray" isActive={activeTool === 'ray'} onClick={() => setActiveTool(activeTool === 'ray' ? 'crosshair' : 'ray')} />
            <ToolIcon icon="⑃" tooltip="Parallel Channel" isActive={activeTool === 'parallel_channel'} onClick={() => setActiveTool(activeTool === 'parallel_channel' ? 'crosshair' : 'parallel_channel')} />
            <ToolIcon icon="F" tooltip="Fib Retracement" isActive={activeTool === 'fib_retracement'} onClick={() => setActiveTool(activeTool === 'fib_retracement' ? 'crosshair' : 'fib_retracement')} />
            <ToolIcon icon="⬜" tooltip="Rectangle" isActive={activeTool === 'rectangle'} onClick={() => setActiveTool(activeTool === 'rectangle' ? 'crosshair' : 'rectangle')} />
            <ToolIcon icon="📏" tooltip="Measure" isActive={activeTool === 'measure'} onClick={() => setActiveTool(activeTool === 'measure' ? 'crosshair' : 'measure')} />
            <div className="flex-1" />
            <ToolIcon icon="🗑" tooltip="Remove Selected" onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
            }} />
          </div>

          {/* Center Chart Column */}
          <div className="flex-1 flex flex-col h-full min-w-0">
            {/* Chart Toolbar */}
            <div className="flex items-center gap-3 px-4 h-11 border-b border-gray-800 bg-[#1E222D] shrink-0 z-30">
              <div className="flex items-center gap-2 mr-4 shrink-0 min-w-0">
                <span className="text-sm font-bold text-white tracking-tight">{symbol}</span>
                {lastClose != null && (
                  <PriceHighlight price={lastClose} className="text-sm font-bold tabular-nums" />
                )}
                {prePostSegments.length > 0 && (
                  <span className="text-[10px] tabular-nums flex items-center gap-2 shrink-0">
                    {prePostSegments.map((seg) => (
                      <span
                        key={seg.kind}
                        className={
                          seg.isActiveSession
                            ? 'text-blue-300 font-semibold'
                            : 'text-gray-400'
                        }
                      >
                        {seg.label} {seg.price.toFixed(2)}
                      </span>
                    ))}
                  </span>
                )}
                {/* Show session badge only when it is NOT already implied by the
                    Pre / Post / O/N highlight above. Always show during regular/closed. */}
                {assetType === 'stock' && selectedTicker?.session && (
                  selectedTicker.session === 'regular' || selectedTicker.session === 'closed' ||
                  !prePostSegments.some((s) => s.isActiveSession)
                ) && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded">
                    {sessionLabel[selectedTicker.session] ?? selectedTicker.session}
                    {selectedTicker.asOf ? ` ${formatEtTime(selectedTicker.asOf)} ET` : ''}
                  </span>
                )}
                {/* When the active session IS pre/post/overnight, replace the verbose
                    badge with a compact ET-time chip — the colored extended-hours
                    line above already conveys which session we're in. */}
                {assetType === 'stock' && selectedTicker?.asOf &&
                  (selectedTicker.session === 'pre' || selectedTicker.session === 'post' || selectedTicker.session === 'overnight') &&
                  prePostSegments.some((s) => s.isActiveSession) && (
                  <span className="text-[10px] text-gray-500 tabular-nums">
                    {formatEtTime(selectedTicker.asOf)} ET
                  </span>
                )}
                {selectedTicker?.isStale && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-yellow-300 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                    Stale
                  </span>
                )}
                {wsStatus !== 'connected' && (
                  <span
                    title={wsStatus === 'reconnecting' ? 'Reconnecting to live data...' : 'Live data disconnected'}
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      wsStatus === 'reconnecting'
                        ? 'bg-yellow-500/15 text-yellow-400 animate-pulse'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    {wsStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}
                  </span>
                )}
              </div>
              <div className="w-px h-5 bg-gray-700 mx-1" />

              {/* Sortable Quick Access Interval Selector */}
              <div className="flex items-center gap-1 relative">
                {quickIntervals.map((int, index) => (
                  <div
                    key={int}
                    draggable
                    onDragStart={(e) => handleQuickDragStart(e, index)}
                    onDrop={(e) => handleQuickDrop(e, index)}
                    onDragOver={handleDragOver}
                    className="cursor-move"
                  >
                    <button
                      onClick={() => handleIntervalChange(int)}
                      className={`px-2 py-1 rounded text-xs transition-colors whitespace-nowrap min-w-[2rem] text-center ${chartInterval === int ? 'bg-[#2962FF] text-white font-semibold' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                      {int}
                    </button>
                  </div>
                ))}

                <div className="relative ml-1" ref={intervalDropdownRef}>
                  <button
                    onClick={() => setShowAllIntervals(!showAllIntervals)}
                    className={`px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors ${showAllIntervals ? 'bg-gray-700 text-white' : ''}`}
                  >
                    ⌄
                  </button>

                  {/* Dropdown Menu */}
                  {showAllIntervals && (
                    <div className="absolute top-full left-0 mt-1 bg-[#1E222D] border border-gray-700 rounded shadow-2xl p-2 grid grid-cols-1 gap-0.5 z-50 min-w-[120px] max-h-[300px] overflow-y-auto">
                      {allIntervals.map(int => {
                        const isInQuick = quickIntervals.includes(int);
                        const canAdd = !isInQuick && quickIntervals.length < 5;
                        const canRemove = isInQuick && quickIntervals.length > 3;

                        return (
                          <div
                            key={int}
                            className={`group flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-700 cursor-pointer ${chartInterval === int ? 'bg-[#2962FF]/10' : ''}`}
                            onClick={() => handleIntervalChange(int)}
                          >
                            <span className={`text-[11px] ${chartInterval === int ? 'text-[#2962FF] font-bold' : 'text-gray-300'}`}>{int}</span>

                            {/* Add/Remove Action (Visible on Hover) */}
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                              {isInQuick && canRemove && (
                                <button
                                  onClick={(e) => toggleQuickAccess(int, e)}
                                  className="text-sm font-bold text-gray-400 hover:text-red-400 hover:bg-red-400/10 cursor-pointer w-5 h-5 flex items-center justify-center rounded transition-colors"
                                  title="Remove from favorites"
                                >
                                  ✕
                                </button>
                              )}
                              {!isInQuick && canAdd && (
                                <button
                                  onClick={(e) => toggleQuickAccess(int, e)}
                                  className="text-sm font-bold text-gray-400 hover:text-[#2962FF] hover:bg-[#2962FF]/10 cursor-pointer w-5 h-5 flex items-center justify-center rounded transition-colors"
                                  title="Add to favorites"
                                >
                                  ＋
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1" />
              <button className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors">📷</button>
            </div>

            {/* Chart Canvas Area */}
            <div className="flex-1 flex flex-col relative bg-[#1E222D] overflow-hidden min-h-0">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1E222D]/80 z-20 backdrop-blur-[1px]">
                  <div className="w-8 h-8 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div className="flex-1 min-h-0 relative">
                {data && <ChartComponent data={data as unknown as CandlestickData<Time>[]} symbol={symbol} indicators={activeIndicators} activeTool={activeTool} />}
              </div>

              {/* ── Bottom Stack ── */}
              <div className="shrink-0 flex flex-col z-30 w-full bg-[#131722]">
                <IndicatorBar activeIndicators={activeIndicators} onChange={setActiveIndicators} />
                <BottomIntervalBar
                  intervals={allIntervals}
                  currentInterval={chartInterval}
                  onIntervalChange={handleIntervalChange}
                />
              </div>
            </div>
          </div>
        </main>

        <WatchlistSidebar
          cryptoWatchlist={cryptoWatchlist}
          stockWatchlist={stockWatchlist}
          symbol={symbol}
          handleSymbolChange={handleSymbolChange}
          setSearchModalMode={setSearchModalMode}
          onSelectedTickerChange={handleSelectedTickerChange}
        />
      </div>

      {/* Unified Search Modal */}
      {searchModalMode !== 'closed' && (
        <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center backdrop-blur-sm" onClick={() => setSearchModalMode('closed')}>
          <div className="bg-[#1E222D] border border-gray-700 rounded-lg shadow-2xl w-[500px] h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-gray-800 shrink-0">
              <h3 className="text-white font-bold">
                {searchModalMode === 'add' ? 'Add Symbol to Watchlist' : 'Search Symbol'}
              </h3>
              <button onClick={() => setSearchModalMode('closed')} className="text-gray-400 hover:text-white transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <SymbolSearch
                mode={searchModalMode}
                onSelect={(sym, type, source) => {
                  if (searchModalMode === 'add') {
                    if (type === 'crypto') {
                      if (!cryptoWatchlist.find(i => i.sym === sym)) {
                        const label = sym.endsWith('USDT') ? sym.replace('USDT', '') : sym;
                        setCryptoWatchlist(prev => [...prev, { sym, label, sub: 'Crypto', source: source || 'Binance' }]);
                      }
                    } else {
                      if (!stockWatchlist.find(i => i.sym === sym)) {
                        setStockWatchlist(prev => [...prev, { sym, label: sym, sub: 'Stock/FX', source: source || 'Yahoo Finance' }]);
                      }
                    }
                  } else {
                    handleSymbolChange(sym, type);
                  }
                  setSearchModalMode('closed');
                }}
                placeholder={searchModalMode === 'add' ? "Search symbol to add..." : "Search symbol to view chart..."}
                className="w-full h-full"
                autoFocus
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ToolIcon = ({ icon, tooltip, isActive, onClick }: { icon: string, tooltip: string, isActive?: boolean, onClick?: () => void }) => (
  <button
    title={tooltip}
    onClick={onClick}
    className={`w-7 h-7 flex items-center justify-center rounded transition-colors text-xs ${isActive ? 'text-[#2962FF] bg-[#2962FF]/10' : 'text-gray-400 hover:text-[#2962FF] hover:bg-[#2962FF]/10'}`}
  >
    {icon}
  </button>
);
