"use client";

import { ChartComponent } from '@/components/ChartComponent';
import { ChatWidget } from '@/components/ChatWidget';
import { NewsFeed } from '@/components/NewsFeed';
import { useMarketData } from '@/hooks/useMarketData';
import { useEffect, useState } from 'react';

export default function Home() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1d');
  const [assetType, setAssetType] = useState('crypto'); // 'crypto' | 'stock'
  const { data, isLoading, isError } = useMarketData(symbol, interval, assetType);

  useEffect(() => {
    if (data && data.length > 0) {
      const lastCandle = data[data.length - 1];
      document.title = `${symbol} - ${lastCandle.close}`;
    } else {
      document.title = 'ViewingChart';
    }
  }, [data, symbol]);

  const handleSymbolChange = (newSymbol: string, type: string) => {
      setSymbol(newSymbol);
      setAssetType(type);
  };

  const CRYPTO_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  const STOCK_INTERVALS = ['1m', '5m', '15m', '30m', '1h'];

  const intervals = assetType === 'crypto' ? CRYPTO_INTERVALS : STOCK_INTERVALS;

  return (
    <main className="flex min-h-screen flex-col items-center p-6 bg-[#131722] text-white">
      <div className="z-10 w-full max-w-7xl items-center justify-between font-mono text-sm flex mb-4">
        <h1 className="text-2xl font-bold">ViewingChart</h1>
        <div className="flex gap-2 items-center">
             <div className="flex bg-[#1E222D] rounded border border-gray-700 p-1 mr-4 overflow-x-auto max-w-[400px]">
                 {intervals.map((int) => (
                    <button 
                        key={int}
                        onClick={() => setInterval(int)}
                        className={`px-2 py-0.5 rounded text-xs transition-colors whitespace-nowrap ${interval === int ? 'bg-[#2962FF] text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        {int}
                    </button>
                 ))}
             </div>

             <span className="text-gray-500 py-2">Crypto:</span>
             <button onClick={() => handleSymbolChange('BTCUSDT', 'crypto')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === 'BTCUSDT' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>BTC</button>
             <button onClick={() => handleSymbolChange('ETHUSDT', 'crypto')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === 'ETHUSDT' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>ETH</button>
             <button onClick={() => handleSymbolChange('SOLUSDT', 'crypto')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === 'SOLUSDT' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>SOL</button>
             
             <span className="text-gray-500 py-2 ml-4">Stock:</span>
             <button onClick={() => handleSymbolChange('AAPL', 'stock')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === 'AAPL' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>AAPL</button>
             <button onClick={() => handleSymbolChange('TSLA', 'stock')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === 'TSLA' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>TSLA</button>
             <button onClick={() => handleSymbolChange('700.HK', 'stock')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === '0700.HK' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>Tencent</button>
             <button onClick={() => handleSymbolChange('600519.SH', 'stock')} className={`px-3 py-1 rounded text-xs font-medium transition-colors ${symbol === '600519.SS' ? 'bg-blue-600' : 'bg-[#2A2E39] hover:bg-gray-700'}`}>Moutai</button>
        </div>
      </div>
        
      <div className="flex flex-col lg:flex-row gap-6 w-full max-w-7xl">
          {/* Main Chart Area */}
          <div className="flex-1 border border-gray-800 rounded-lg overflow-hidden shadow-2xl relative bg-[#1E222D]">
              {isLoading && <div className="absolute inset-0 flex items-center justify-center bg-[#1E222D] z-20">Loading...</div>}
              {isError && <div className="absolute inset-0 flex items-center justify-center bg-red-900/50 z-20 text-red-400">Error fetching data (Check API Logs)</div>}
              {data && <ChartComponent data={data} symbol={symbol} />}
          </div>

          {/* Sidebar Area */}
          <div className="w-full lg:w-80 shrink-0">
             <NewsFeed />
          </div>
      </div>
      
      <ChatWidget chartData={data} />
    </main>
  );
}
