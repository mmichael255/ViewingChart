"use client";

import { SymbolOverview } from '@/components/SymbolOverview';
import { useEffect, useState, useMemo, useCallback } from 'react';
import type { KlineData, TickerData } from '@/types/market';
import { WatchlistSidebar } from '@/components/WatchlistSidebar';
import { SymbolSearch } from '@/components/SymbolSearch'; // New
import Link from 'next/link';
import { API_URL } from '@/config';
import { getAccessToken } from '@/lib/auth';
import { fetchJson } from '@/lib/api';
import type { WatchlistSummary } from '@/components/WatchlistSidebar';
import type { WatchlistItem } from '@/types/market';
import { UserMenu } from '@/components/UserMenu';
import { MacroBar } from '@/components/MacroBar';
import { AgentPanel } from '@/components/AgentPanel';
import { NewsFeed } from '@/components/NewsFeed';
import { useResizable } from '@/hooks/useResizable';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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

type ApiWatchlistItem = {
  id: number;
  sym: string;
  asset_type: 'crypto' | 'stock';
  position: number;
  exchange?: string | null;
  source?: string | null;
  label?: string | null;
  sub?: string | null;
};

export default function Home() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [chartInterval, setChartInterval] = useState('1d');
  const [assetType, setAssetType] = useState('crypto');

  const [watchlists, setWatchlists] = useState<WatchlistSummary[] | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<number | null>(null);
  const [orderedWatchlistItems, setOrderedWatchlistItems] = useState<ApiWatchlistItem[] | null>(null);
  const [cryptoWatchlist, setCryptoWatchlist] = useState<WatchlistItem[]>(INITIAL_CRYPTO_WATCHLIST);
  const [stockWatchlist, setStockWatchlist] = useState<WatchlistItem[]>(STOCK_WATCHLIST);
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
  const [enrichedTickerBySymbol, setEnrichedTickerBySymbol] = useState<Record<string, TickerData>>({});

  // Sidebar resize + collapse
  const { size: sidebarWidth, isDragging: isSidebarDragging, handleProps: sidebarHandleProps } = useResizable({
    initialSize: 320,
    minSize: 200,
    maxSize: 600,
    direction: 'horizontal',
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // (unused chart state removed — chart lives at /chart now)

  // MiniChart klines — lifted up from MiniChart to share with QuickTechnicals
  const [miniChartKlines, setMiniChartKlines] = useState<KlineData[] | undefined>(undefined);

  // Fields that the enriched REST ticker (CoinGecko / Alpha Vantage) should
  // contribute — never override the live WS price/change values from watchlistTicker.
  const ENRICHMENT_ONLY_KEYS = new Set([
    "marketCap", "enterpriseValue", "fullyDilutedValuation",
    "totalVolume", "high24h", "low24h",
    "circulatingSupply", "totalSupply", "maxSupply",
    "ath", "atl", "genesisDate", "marketCapRank",
    "previousClose", "dayHigh", "dayLow", "dayOpen",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
    "avgVolume", "sharesOutstanding", "floatShares",
    "sector", "industry", "startDate",
  ]);

  function pickEnrichment(t: TickerData): Partial<TickerData> {
    const out: Record<string, unknown> = {};
    for (const key of ENRICHMENT_ONLY_KEYS) {
      if (key in t) out[key] = (t as unknown as Record<string, unknown>)[key];
    }
    return out as Partial<TickerData>;
  }

  const extraTicker = extraTickerBySymbol[symbol];
  const enrichedTicker = enrichedTickerBySymbol[symbol];
  const selectedTicker = (() => {
    const base = watchlistTicker ?? extraTicker;
    if (enrichedTicker && base) {
      // Only merge enrichment fields — don't let stale REST price/change
      // overwrite live WS values from watchlistTicker.
      return { ...base, ...pickEnrichment(enrichedTicker) };
    }
    return base ?? enrichedTicker;
  })();

  const handleSelectedTickerChange = useCallback((ticker: TickerData | undefined) => {
    setWatchlistTicker(ticker);
  }, []);

  /** Stable reference for sidebar — avoids resetting edit order every parent render. */
  const sidebarOrderedItems = useMemo((): WatchlistItem[] | undefined => {
    if (!orderedWatchlistItems?.length) return undefined;
    return orderedWatchlistItems.map((i) => ({
      id: i.id,
      sym: i.sym,
      label: i.label ?? i.sym,
      sub: i.sub ?? (i.asset_type === 'stock' ? 'Stock/FX' : 'Crypto'),
      source: i.source ?? undefined,
      asset_type: i.asset_type,
      position: i.position,
    }));
  }, [orderedWatchlistItems]);

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

  // Always fetch enriched REST ticker for the active symbol (needed for
  // CoinGecko enrichment on crypto, or when watchlist WS doesn't have
  // fundamental data). Runs regardless of assetType or watchlistTicker.
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    const paramName = assetType === 'crypto' ? 'crypto_symbols' : 'stock_symbols';
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/market/tickers?${paramName}=${encodeURIComponent(symbol)}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, TickerData>;
        const t = data?.[symbol];
        if (t) setEnrichedTickerBySymbol((prev) => ({ ...prev, [symbol]: t }));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    })();
    return () => {
      controller.abort();
    };
  }, [symbol, assetType]);

  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [me, setMe] = useState<{ role?: string | null } | null>(null);

  const handleAuthChange = useCallback(() => {
    setToken(getAccessToken());
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!token) {
      setMe(null);
      return;
    }
    (async () => {
      try {
        const data = await fetchJson<{ role?: string | null }>('/me', { auth: true });
        setMe(data);
      } catch {
        setMe(null);
      }
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [token]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!token) {
      setWatchlists(null);
      setSelectedWatchlistId(null);
      setCryptoWatchlist(INITIAL_CRYPTO_WATCHLIST);
      setStockWatchlist(STOCK_WATCHLIST);
      return;
    }

    (async () => {
      try {
        const wls = await fetchJson<WatchlistSummary[]>('/watchlists', { auth: true });
        setWatchlists(wls);
        const def = wls.find(w => w.is_default) ?? wls[0];
        if (def) setSelectedWatchlistId(def.id);
      } catch {
        setWatchlists(null);
        setSelectedWatchlistId(null);
      }
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [token]);

  useEffect(() => {
    if (!token || !selectedWatchlistId) return;
    (async () => {
      try {
        const items = await fetchJson<ApiWatchlistItem[]>(
          `/watchlists/${selectedWatchlistId}/items`,
          { auth: true },
        );
        setOrderedWatchlistItems(items);
        const crypto: WatchlistItem[] = [];
        const stocks: WatchlistItem[] = [];
        for (const i of items) {
          const mapped: WatchlistItem = {
            id: i.id,
            sym: i.sym,
            label: i.label ?? i.sym,
            sub: i.sub ?? (i.asset_type === 'stock' ? 'Stock/FX' : 'Crypto'),
            source: i.source ?? undefined,
            asset_type: i.asset_type,
            position: i.position,
          };
          if (i.asset_type === 'stock') stocks.push(mapped);
          else crypto.push(mapped);
        }
        setCryptoWatchlist(crypto);
        setStockWatchlist(stocks);
      } catch {
        // ignore
      }
    })();
  }, [token, selectedWatchlistId]);

  async function createWatchlist(name: string) {
    if (!token) return;
    const wl = await fetchJson<WatchlistSummary>('/watchlists', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ name, is_default: false }),
    });
    const wls = await fetchJson<WatchlistSummary[]>('/watchlists', { auth: true });
    setWatchlists(wls);
    setSelectedWatchlistId(wl.id);
  }

  async function renameWatchlist(name: string) {
    if (!token || !selectedWatchlistId || !watchlists) return;
    await fetchJson<WatchlistSummary>(`/watchlists/${selectedWatchlistId}`, {
      method: 'PATCH',
      auth: true,
      body: JSON.stringify({ name }),
    });
    const wls = await fetchJson<WatchlistSummary[]>('/watchlists', { auth: true });
    setWatchlists(wls);
  }

  async function deleteWatchlist() {
    if (!token || !selectedWatchlistId) return;
    await fetchJson<void>(`/watchlists/${selectedWatchlistId}`, { method: 'DELETE', auth: true });
    const wls = await fetchJson<WatchlistSummary[]>('/watchlists', { auth: true });
    setWatchlists(wls);
    const def = wls.find(w => w.is_default) ?? wls[0] ?? null;
    setSelectedWatchlistId(def?.id ?? null);
  }

  async function removeItem(sym: string, itemType: string) {
    if (!token || !selectedWatchlistId) return;
    const target =
      orderedWatchlistItems?.find(
        i => i.sym === sym && i.asset_type === (itemType === 'stock' ? 'stock' : 'crypto'),
      ) ??
      (
        await fetchJson<ApiWatchlistItem[]>(
          `/watchlists/${selectedWatchlistId}/items`,
          { auth: true },
        )
      ).find(i => i.sym === sym && i.asset_type === (itemType === 'stock' ? 'stock' : 'crypto'));
    if (!target) return;
    await fetchJson<void>(`/watchlists/${selectedWatchlistId}/items/${target.id}`, { method: 'DELETE', auth: true });
    const refreshed = await fetchJson<ApiWatchlistItem[]>(
      `/watchlists/${selectedWatchlistId}/items`,
      { auth: true },
    );
    setOrderedWatchlistItems(refreshed);
    const crypto: WatchlistItem[] = [];
    const stocks: WatchlistItem[] = [];
    for (const i of refreshed) {
      const mapped: WatchlistItem = {
        id: i.id,
        sym: i.sym,
        label: i.label ?? i.sym,
        sub: i.sub ?? (i.asset_type === 'stock' ? 'Stock/FX' : 'Crypto'),
        source: i.source ?? undefined,
        asset_type: i.asset_type,
        position: i.position,
      };
      if (i.asset_type === 'stock') stocks.push(mapped);
      else crypto.push(mapped);
    }
    setCryptoWatchlist(crypto);
    setStockWatchlist(stocks);
  }

  async function reorderWatchlistItemsByIds(itemIds: number[]) {
    if (!token || !selectedWatchlistId) return;
    await fetchJson<void>(`/watchlists/${selectedWatchlistId}/items/reorder`, {
      method: 'PUT',
      auth: true,
      body: JSON.stringify({ item_ids: itemIds }),
    });
    const refreshed = await fetchJson<ApiWatchlistItem[]>(
      `/watchlists/${selectedWatchlistId}/items`,
      { auth: true },
    );
    setOrderedWatchlistItems(refreshed);
    const crypto: WatchlistItem[] = [];
    const stocks: WatchlistItem[] = [];
    for (const i of refreshed) {
      const mapped: WatchlistItem = {
        id: i.id,
        sym: i.sym,
        label: i.label ?? i.sym,
        sub: i.sub ?? (i.asset_type === 'stock' ? 'Stock/FX' : 'Crypto'),
        source: i.source ?? undefined,
        asset_type: i.asset_type,
        position: i.position,
      };
      if (i.asset_type === 'stock') stocks.push(mapped);
      else crypto.push(mapped);
    }
    setCryptoWatchlist(crypto);
    setStockWatchlist(stocks);
  }

  async function copyItemToWatchlist(itemId: number, destWatchlistId: number) {
    if (!token || !selectedWatchlistId) return;
    await fetchJson<void>(`/watchlists/${destWatchlistId}/items/copy`, {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ from_watchlist_id: selectedWatchlistId, item_ids: [itemId] }),
    });
  }

  /** Document title from MiniChart's last close (reuses MiniChart klines). */
  const lastClose = useMemo(() => {
    if (!miniChartKlines?.length) return null;
    const c = miniChartKlines[miniChartKlines.length - 1].close;
    const n = typeof c === 'number' ? c : Number(c);
    return Number.isFinite(n) ? n : null;
  }, [miniChartKlines]);

  useEffect(() => {
    if (lastClose != null) {
      document.title = `${lastClose.toFixed(2)} · ${symbol} · ViewingChart`;
    } else {
      document.title = 'ViewingChart';
    }
  }, [lastClose, symbol]);

  // Flat watchlist for keyboard cycling
  const flatWatchlist = useMemo(() => {
    if (orderedWatchlistItems && orderedWatchlistItems.length > 0) {
      return orderedWatchlistItems.map(i => ({ sym: i.sym, type: i.asset_type }));
    }
    return [
      ...cryptoWatchlist.map(i => ({ sym: i.sym, type: 'crypto' as const })),
      ...stockWatchlist.map(i => ({ sym: i.sym, type: 'stock' as const })),
    ];
  }, [orderedWatchlistItems, cryptoWatchlist, stockWatchlist]);

  const handleSymbolChange = (newSymbol: string, type: string) => {
    setSymbol(newSymbol);
    setAssetType(type);
    if (type !== assetType) {
      setChartInterval(type === 'crypto' ? '1d' : '1h');
    }
  };

  const handleIntervalChange = (newInterval: string) => {
    setChartInterval(newInterval);
  };

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    'Escape': () => {
      setSearchModalMode('closed');
      setShowShortcutsHelp(false);
    },
    '/': () => setSearchModalMode('search'),
    'Shift+/': () => setShowShortcutsHelp(v => !v),
    'Ctrl+b': () => setSidebarCollapsed(v => !v),
    'Ctrl+Shift+]': () => {
      const idx = flatWatchlist.findIndex(i => i.sym === symbol && i.type === assetType);
      if (idx >= 0 && idx < flatWatchlist.length - 1) {
        const next = flatWatchlist[idx + 1];
        handleSymbolChange(next.sym, next.type);
      }
    },
    'Ctrl+Shift+[': () => {
      const idx = flatWatchlist.findIndex(i => i.sym === symbol && i.type === assetType);
      if (idx > 0) {
        const prev = flatWatchlist[idx - 1];
        handleSymbolChange(prev.sym, prev.type);
      }
    },
  });

  return (
    <div className="flex flex-col h-full min-h-screen bg-black text-[#E6EDF3] overflow-hidden">
      {/* ── Global Header ── */}
      <header className="flex items-center justify-between px-5 h-12 border-b border-[#30363D] bg-black shrink-0 z-40 relative">
        <div className="flex items-center gap-2 w-1/4">
          <span className="text-[#E6EDF3] font-bold text-lg tracking-tight">ViewingChart</span>
        </div>

        <div className="flex-1 flex justify-center w-2/4">
          <button
            onClick={() => setSearchModalMode('search')}
            className="w-72 bg-[#1E222D] border border-[#30363D] text-[#E6EDF3] placeholder-[#6E7681] py-2 text-sm rounded-full text-left pl-4 hover:border-[#D1D5DB] transition-colors flex items-center"
          >
            <span className="text-[#6E7681]">Search</span>
          </button>
        </div>

        <div className="flex items-center gap-3 justify-end w-1/4">
          {me?.role === 'superadmin' && (
            <Link
              href="/monitor"
              className="text-xs text-[#6E7681] hover:text-[#8B949E] transition-colors"
              title="Connection monitor"
            >
              Monitor
            </Link>
          )}
          <UserMenu onAuthChange={handleAuthChange} />
        </div>
      </header>

      {/* ── Macro Strip ── */}
      <MacroBar />

      {/* ── Body: 3-column layout ── */}
      <ErrorBoundary>
        <div className="flex flex-1 overflow-hidden h-full p-1 relative">
        {/* ── Agent Panel (left) ── */}
        <AgentPanel />

        {/* ── Symbol Overview (center) ── */}
        <main className="flex-1 flex h-full overflow-hidden relative bg-[#0D1117]">
          <SymbolOverview
            symbol={symbol}
            assetType={assetType}
            ticker={selectedTicker}
            klines={miniChartKlines}
            onOpenChart={() => {
              window.open(`/chart?symbol=${encodeURIComponent(symbol)}`, "_self");
            }}
            onMiniChartData={setMiniChartKlines}
          />
        </main>

        {!sidebarCollapsed && (
          <div
            onMouseDown={sidebarHandleProps.onMouseDown}
            className="w-1 shrink-0 cursor-col-resize bg-black hover:bg-black active:bg-black"
          />
        )}

        <div
          className={`shrink-0 ${sidebarCollapsed ? 'w-0 overflow-hidden' : ''}`}
          style={sidebarCollapsed ? {} : { width: sidebarWidth }}
        >
          {sidebarCollapsed ? null : (
            <WatchlistSidebar
              watchlists={watchlists ?? undefined}
              selectedWatchlistId={selectedWatchlistId}
              onSelectWatchlist={(id) => setSelectedWatchlistId(id)}
              onCreateWatchlist={token ? createWatchlist : undefined}
              onRenameWatchlist={token ? renameWatchlist : undefined}
              onDeleteWatchlist={token ? deleteWatchlist : undefined}
              onRemoveItem={token ? removeItem : undefined}
              orderedItems={sidebarOrderedItems}
              onReorderItems={token ? reorderWatchlistItemsByIds : undefined}
              onCopyItemToWatchlist={token ? copyItemToWatchlist : undefined}
              cryptoWatchlist={cryptoWatchlist}
              stockWatchlist={stockWatchlist}
              symbol={symbol}
              assetType={assetType}
              chartInterval={chartInterval}
              chartKlines={miniChartKlines}
              chartKlinesLoading={miniChartKlines === undefined}
              mergedTicker={selectedTicker}
              handleSymbolChange={handleSymbolChange}
              setSearchModalMode={setSearchModalMode}
              onSelectedTickerChange={handleSelectedTickerChange}
            />
          )}
        </div>

        {/* Sidebar collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute right-0 top-0 z-50 w-5 h-10 flex items-center justify-center bg-black border border-[#30363D] rounded-l text-[#8B949E] hover:text-[#E6EDF3] hover:bg-black transition-colors text-xs"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? '◀' : '▶'}
        </button>
      </div>
      </ErrorBoundary>

      {/* Unified Search Modal */}
      {searchModalMode !== 'closed' && (
        <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center backdrop-blur-sm" onClick={() => setSearchModalMode('closed')} onKeyDown={(e) => { if (e.key === 'Escape') setSearchModalMode('closed'); }}>
          <div className="bg-black border border-[#21262D] rounded-lg shadow-2xl w-[500px] h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-[#30363D] shrink-0">
              <h3 className="text-[#E6EDF3] font-bold">
                {searchModalMode === 'add' ? 'Add Symbol to Watchlist' : 'Search Symbol'}
              </h3>
              <button onClick={() => setSearchModalMode('closed')} className="text-[#8B949E] hover:text-[#E6EDF3] transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <SymbolSearch
                mode={searchModalMode}
                onSelect={(sym, type, source) => {
                  if (searchModalMode === 'add') {
                    if (token && selectedWatchlistId) {
                      void (async () => {
                        await fetchJson(`/watchlists/${selectedWatchlistId}/items`, {
                          method: 'POST',
                          auth: true,
                          body: JSON.stringify({
                            sym,
                            asset_type: type === 'stock' ? 'stock' : 'crypto',
                            source: source || (type === 'stock' ? 'Yahoo Finance' : 'Binance'),
                            label: type === 'crypto' ? (sym.endsWith('USDT') ? sym.replace('USDT', '') : sym) : sym,
                            sub: type === 'stock' ? 'Stock/FX' : 'Crypto',
                          }),
                        });
                        const items = await fetchJson<ApiWatchlistItem[]>(
                          `/watchlists/${selectedWatchlistId}/items`,
                          { auth: true },
                        );
                        setOrderedWatchlistItems(items);
                        const crypto: WatchlistItem[] = [];
                        const stocks: WatchlistItem[] = [];
                        for (const i of items) {
                          const mapped: WatchlistItem = {
                            id: i.id,
                            sym: i.sym,
                            label: i.label ?? i.sym,
                            sub: i.sub ?? (i.asset_type === 'stock' ? 'Stock/FX' : 'Crypto'),
                            source: i.source ?? undefined,
                            asset_type: i.asset_type,
                            position: i.position,
                          };
                          if (i.asset_type === 'stock') stocks.push(mapped);
                          else crypto.push(mapped);
                        }
                        setCryptoWatchlist(crypto);
                        setStockWatchlist(stocks);
                      })();
                    } else {
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

      <KeyboardShortcutsHelp isOpen={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

      {/* ── Bottom News Feed ── */}
      <div className="shrink-0 border-t border-[#30363D] bg-[#0D1117] overflow-hidden">
        <NewsFeed compact />
      </div>
    </div>
  );
}