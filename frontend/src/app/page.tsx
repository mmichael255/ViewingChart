"use client";

import { ChartComponent } from '@/components/ChartComponent';
import { NewsFeed } from '@/components/NewsFeed';
import { PriceHighlight } from '@/components/Highlighting';
import { IndicatorBar, IndicatorConfig, availableIndicators } from '@/components/IndicatorBar';
import { BottomIntervalBar } from '@/components/BottomIntervalBar';
import { useMarketData } from '@/hooks/useMarketData';
import { useEffect, useState, useRef } from 'react';
import { API_URL, WS_URL } from '@/config';
import type { CandlestickData, Time } from 'lightweight-charts';
import type { TickerData, WatchlistItem } from '@/types/market';

import { SymbolSearch } from '@/components/SymbolSearch'; // New

const INITIAL_CRYPTO_WATCHLIST = [
  { sym: 'BTCUSDT', label: 'BTC', sub: 'Bitcoin' },
  { sym: 'ETHUSDT', label: 'ETH', sub: 'Ethereum' },
  { sym: 'SOLUSDT', label: 'SOL', sub: 'Solana' },
  { sym: 'XAUUSDT', label: 'XAU', sub: 'Gold' },
  { sym: 'XAGUSDT', label: 'XAG', sub: 'Silver' },
];

const STOCK_WATCHLIST = [
  { sym: 'NVDA', label: 'NVDA', sub: 'NVIDIA' },
  { sym: 'GOOG', label: 'GOOG', sub: 'Alphabet Inc.' },
  { sym: 'TSLA', label: 'TSLA', sub: 'Tesla Inc.' },
  { sym: 'AAPL', label: 'AAPL', sub: 'Apple Inc.' },
];

export default function Home() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [chartInterval, setChartInterval] = useState('1d');
  const [assetType, setAssetType] = useState('crypto');

  const [cryptoWatchlist, setCryptoWatchlist] = useState(INITIAL_CRYPTO_WATCHLIST);
  const [searchModalMode, setSearchModalMode] = useState<'closed' | 'search' | 'add'>('closed');

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

  // Ticker state for watchlist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tickers, setTickers] = useState<Record<string, any>>({});

  const { data, isLoading, isError } = useMarketData(symbol, chartInterval, assetType);

  // Data Fetching Logic
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const cryptos = cryptoWatchlist.map(i => i.sym).join(',');
        const stocks = STOCK_WATCHLIST.map(i => i.sym).join(',');
        const res = await fetch(`${API_URL}/market/tickers?crypto_symbols=${cryptos}&stock_symbols=${stocks}`);
        const newData = await res.json();
        setTickers(prev => ({ ...prev, ...newData }));
      } catch (err) {
        console.error("Failed to fetch tickers:", err);
      }
    };
    fetchTickers();
    const id = window.setInterval(fetchTickers, 10000);
    return () => window.clearInterval(id);
  }, [cryptoWatchlist]);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
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
        // Backend broadcast_ticker natively sends: { "BTCUSDT": { lastPrice: X, ... } }
        if (payload && typeof payload === 'object') {
          setTickers(prev => ({ ...prev, ...payload }));
        }
      } catch (e) {
        console.error("WS Ticker parsing error", e);
      }
    };

    return () => socket.close();
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

  useEffect(() => {
    if (data && data.length > 0) {
      document.title = `${symbol} - ${data[data.length - 1].close}`;
    } else {
      document.title = 'ViewingChart';
    }
  }, [data, symbol]);

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
  const STOCK_INTERVALS = ['1m', '5m', '15m', '30m', '1h'];
  const allIntervals = assetType === 'crypto' ? CRYPTO_INTERVALS : STOCK_INTERVALS;

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
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400 cursor-pointer hover:bg-gray-600">👤</div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden h-full gap-1 p-1">
        {/* ── Main Chart Wrapper ── */}
        <main className="flex-1 flex h-full overflow-hidden relative border border-gray-800 bg-[#1E222D]">
          {/* LEFT Drawing Toolbar */}
          <div className="w-10 flex flex-col items-center border-r border-gray-800 bg-[#1E222D] py-2 gap-2 z-30 shrink-0">
            <ToolIcon icon="✜" tooltip="Crosshair" />
            <ToolIcon icon="／" tooltip="Trend Line" />
            <ToolIcon icon="⑃" tooltip="Pitchfork" />
            <ToolIcon icon="🖌" tooltip="Brush" />
            <ToolIcon icon="T" tooltip="Text" />
            <ToolIcon icon="abcd" tooltip="Patterns" />
            <ToolIcon icon="⬆⬇" tooltip="Prediction" />
            <ToolIcon icon="📏" tooltip="Measure" />
            <div className="flex-1" />
            <ToolIcon icon="🗑" tooltip="Remove Objects" />
          </div>

          {/* Center Chart Column */}
          <div className="flex-1 flex flex-col h-full min-w-0">
            {/* Chart Toolbar */}
            <div className="flex items-center gap-3 px-4 h-11 border-b border-gray-800 bg-[#1E222D] shrink-0 z-30">
              <div className="flex items-center gap-3 mr-4 shrink-0">
                <span className="text-sm font-bold text-white tracking-tight">{symbol}</span>
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
                {data && <ChartComponent data={data as unknown as CandlestickData<Time>[]} symbol={symbol} indicators={activeIndicators} />}
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

        {/* ── Sidebar ── */}
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
                <WatchlistGroup title="Crypto" items={cryptoWatchlist} tickers={tickers} handleSymbolChange={handleSymbolChange} symbol={symbol} type="crypto" />
                <WatchlistGroup title="Stocks" items={STOCK_WATCHLIST} tickers={tickers} handleSymbolChange={handleSymbolChange} symbol={symbol} type="stock" />
              </div>
            </div>
            <div className="flex-1 flex flex-col bg-[#1E222D] overflow-hidden">
              <NewsFeed compact />
            </div>
          </div>
        </aside>
      </div>

      {/* Unified Search Modal */}
      {searchModalMode !== 'closed' && (
        <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center backdrop-blur-sm" onClick={() => setSearchModalMode('closed')}>
          <div className="bg-[#1E222D] border border-gray-700 rounded-lg shadow-2xl w-[500px] h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-gray-800 shrink-0">
              <h3 className="text-white font-bold">
                {searchModalMode === 'add' ? 'Add Crypto to Watchlist' : 'Search Crypto'}
              </h3>
              <button onClick={() => setSearchModalMode('closed')} className="text-gray-400 hover:text-white transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <SymbolSearch
                mode={searchModalMode}
                onSelect={(sym, type) => {
                  if (searchModalMode === 'add') {
                    if (!cryptoWatchlist.find(i => i.sym === sym)) {
                      const label = sym.endsWith('USDT') ? sym.replace('USDT', '') : sym;
                      setCryptoWatchlist(prev => [...prev, { sym, label, sub: 'Crypto' }]);
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

const ToolIcon = ({ icon, tooltip }: { icon: string, tooltip: string }) => (
  <button title={tooltip} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-[#2962FF] hover:bg-[#2962FF]/10 rounded transition-colors text-xs">
    {icon}
  </button>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WatchlistGroup = ({ title, items, tickers, handleSymbolChange, symbol, type }: any) => (
  <>
    <div className="px-3 py-1 mb-1 mt-2">
      <span className="text-[9px] font-black text-[#2962FF] uppercase tracking-widest">{title}</span>
    </div>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
    {items.map(({ sym, label, sub }: any) => {
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
            <div className="text-[8px] text-gray-500 font-medium truncate mt-0.5">{sub}</div>
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
