"use client";

import { ChartComponent } from '@/components/ChartComponent';
import { NewsFeed } from '@/components/NewsFeed';
import { PriceHighlight } from '@/components/Highlighting';
import { IndicatorBar } from '@/components/IndicatorBar'; // New
import { BottomIntervalBar } from '@/components/BottomIntervalBar'; // New
import { useMarketData } from '@/hooks/useMarketData';
import { useEffect, useState, useRef } from 'react';

export default function Home() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [chartInterval, setChartInterval] = useState('1d');
  const [assetType, setAssetType] = useState('crypto');

  // Quick Access Intervals
  // Default: 15m, 1h, 4h, 1d, 1w
  const [quickIntervals, setQuickIntervals] = useState(['15m', '1h', '4h', '1d', '1w']);
  const [showAllIntervals, setShowAllIntervals] = useState(false);

  // Ticker state for watchlist
  const [tickers, setTickers] = useState<Record<string, any>>({});

  const { data, isLoading, isError } = useMarketData(symbol, chartInterval, assetType);

  const CRYPTO_WATCHLIST = [
    { sym: 'BTCUSDT', label: 'BTC', sub: 'Bitcoin' },
    { sym: 'ETHUSDT', label: 'ETH', sub: 'Ethereum' },
    { sym: 'SOLUSDT', label: 'SOL', sub: 'Solana' },
  ];

  const STOCK_WATCHLIST = [
    { sym: 'AAPL', label: 'AAPL', sub: 'Apple Inc.' },
    { sym: 'TSLA', label: 'TSLA', sub: 'Tesla Inc.' },
    { sym: '700.HK', label: '700.HK', sub: 'Tencent' },
    { sym: '600519.SH', label: '600519.SH', sub: 'Moutai' },
  ];

  // Data Fetching Logic (Same as before)
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const cryptos = CRYPTO_WATCHLIST.map(i => i.sym).join(',');
        const stocks = STOCK_WATCHLIST.map(i => i.sym).join(',');
        const res = await fetch(`http://localhost:8000/market/tickers?crypto_symbols=${cryptos}&stock_symbols=${stocks}`);
        const newData = await res.json();
        setTickers(prev => ({ ...prev, ...newData }));
      } catch (err) {
        console.error("Failed to fetch tickers:", err);
      }
    };
    fetchTickers();
    const id = window.setInterval(fetchTickers, 10000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8000/market/ws/tickers');
    socket.onmessage = (event) => {
      const updates = JSON.parse(event.data);
      setTickers(prev => ({ ...prev, ...updates }));
    };
    return () => socket.close();
  }, []);

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

  // 1. Reorder Quick Access (via Dragging the Toolbar Items)
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

  // 2. Add/Remove from Dropdown
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
      <header className="flex items-center justify-between px-5 h-12 border-b border-gray-800 bg-[#1E222D] shrink-0 z-40">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-lg tracking-tight">ViewingChart</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400 cursor-pointer hover:bg-gray-600">👤</div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden h-full gap-1 p-1">

        {/* ── Main Chart Wrapper ── */}
        <main className="flex-1 flex h-full overflow-hidden relative border border-gray-800 bg-[#1E222D]">

          {/* LEFT Drawing Toolbar (Moved from Right) */}
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
                    className="cursor-move" // visual indicator for dragging
                  >
                    <button
                      onClick={() => handleIntervalChange(int)}
                      className={`px-2 py-1 rounded text-xs transition-colors whitespace-nowrap min-w-[2rem] text-center ${chartInterval === int ? 'bg-[#2962FF] text-white font-semibold' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                      {int}
                    </button>
                  </div>
                ))}

                <div className="relative ml-1">
                  <button
                    onClick={() => setShowAllIntervals(!showAllIntervals)}
                    className={`px-1 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors ${showAllIntervals ? 'bg-gray-700 text-white' : ''}`}
                  >
                    ⌄
                  </button>

                  {/* Dropdown Menu */}
                  {showAllIntervals && (
                    <div className="absolute top-full left-0 mt-1 bg-[#1E222D] border border-gray-700 rounded shadow-2xl p-2 grid grid-cols-1 gap-0.5 z-50 min-w-[120px] max-h-[300px] overflow-y-auto">
                      <div className="text-[10px] text-gray-500 font-bold px-2 py-1 uppercase">Select Interval</div>
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
                                  className="text-[10px] text-gray-500 hover:text-red-400"
                                  title="Remove from favorites"
                                >
                                  ✕
                                </button>
                              )}
                              {!isInQuick && canAdd && (
                                <button
                                  onClick={(e) => toggleQuickAccess(int, e)}
                                  className="text-[10px] text-gray-500 hover:text-[#2962FF]"
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
                {data && <ChartComponent data={data} symbol={symbol} />}
              </div>

              {/* ── Bottom Stack ── */}
              <div className="shrink-0 flex flex-col z-30 w-full bg-[#131722]">
                <IndicatorBar />
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
            <div className="flex flex-col shrink-0 min-h-[400px] h-[50%] border-b border-gray-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center bg-[#1E222D]">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Watchlist</span>
                <button className="text-[9px] font-bold text-[#2962FF] hover:text-white bg-[#2962FF]/10 px-2 py-0.5 rounded transition-all">＋</button>
              </div>
              <div className="grid grid-cols-12 px-4 py-1.5 text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-gray-800/50 bg-[#1E222D]">
                <div className="col-span-4">Symbol</div>
                <div className="col-span-3 text-right">Last</div>
                <div className="col-span-2 text-right">Chg</div>
                <div className="col-span-3 text-right">Chg%</div>
              </div>
              <div className="flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-800">
                <WatchlistGroup title="Crypto" items={CRYPTO_WATCHLIST} tickers={tickers} handleSymbolChange={handleSymbolChange} symbol={symbol} type="crypto" />
                <WatchlistGroup title="Stocks" items={STOCK_WATCHLIST} tickers={tickers} handleSymbolChange={handleSymbolChange} symbol={symbol} type="stock" />
              </div>
            </div>
            <div className="flex-1 flex flex-col bg-[#1E222D] overflow-hidden">
              <NewsFeed compact />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const ToolIcon = ({ icon, tooltip }: { icon: string, tooltip: string }) => (
  <button title={tooltip} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-[#2962FF] hover:bg-[#2962FF]/10 rounded transition-colors text-xs">
    {icon}
  </button>
);

const WatchlistGroup = ({ title, items, tickers, handleSymbolChange, symbol, type }: any) => (
  <>
    <div className="px-3 py-1 mb-1 mt-2">
      <span className="text-[9px] font-black text-[#2962FF] uppercase tracking-widest">{title}</span>
    </div>
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
