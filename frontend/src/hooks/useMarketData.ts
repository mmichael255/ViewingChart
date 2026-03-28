import useSWR from 'swr';
import { useEffect, useState, useRef, useCallback } from 'react';
import { API_URL, WS_URL } from '@/config';
import type { KlineData } from '@/types/market';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useMarketData(symbol: string, interval: string = '1d', assetType: string = 'crypto') {

    // Fetch initial data
    const { data: initialData, error, isLoading, mutate } = useSWR<KlineData[]>(
        `${API_URL}/market/klines/${symbol}?interval=${interval}&asset_type=${assetType}`,
        fetcher,
        {
            refreshInterval: assetType === 'stock' ? 60000 : 0, // Poll stocks only, WS handles crypto
            revalidateOnFocus: false
        }
    );

    const [realtimeData, setRealtimeData] = useState<KlineData[] | undefined>(undefined);
    const wsRef = useRef<WebSocket | null>(null);

    // Refs to prevent stale closures in reconnect callbacks
    const symbolRef = useRef(symbol);
    const intervalRef = useRef(interval);
    const assetTypeRef = useRef(assetType);

    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { intervalRef.current = interval; }, [interval]);
    useEffect(() => { assetTypeRef.current = assetType; }, [assetType]);

    const initialDataRef = useRef<KlineData[]>([]);
    useEffect(() => {
        if (initialData) {
            initialDataRef.current = initialData;
            setRealtimeData(initialData);
        }
    }, [initialData]);

    // Track when initial data changes to optionally reset realtime data if symbol changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
        setRealtimeData(undefined);
        initialDataRef.current = []; // CRITICAL FIX: explicit wipe of stale history on symbol change
    }, [symbol, interval, assetType]);

    // ── Fix #5.1 — Batch WS updates via requestAnimationFrame ──
    // Instead of calling setRealtimeData on every WS message (1–2 Hz),
    // we buffer the latest update in a ref and flush once per animation frame.
    const pendingUpdateRef = useRef<KlineData | null>(null);
    const rafIdRef = useRef<number>(0);

    const applyUpdate = useCallback((currentData: KlineData[] | undefined, update: KlineData): KlineData[] | undefined => {
        const baseData = currentData || initialDataRef.current;
        if (!baseData || baseData.length === 0) return currentData;

        const lastCandle = baseData[baseData.length - 1];

        // Safeguard against corrupted data
        if (!lastCandle || !update || typeof lastCandle.time === 'undefined') {
            console.error('applyUpdate CRASH AVOIDED. baseData length:', baseData.length, 'lastCandle:', lastCandle, 'update:', update);
            return currentData;
        }

        const tLast = Number(lastCandle.time);
        const tUp = Number(update.time);
        if (tLast === tUp) {
            // Update existing candle in-place (shallow copy only the array, reuse all other objects)
            const newData = baseData.slice();
            newData[newData.length - 1] = update;
            return newData;
        } else if (tUp > tLast) {
            return [...baseData, update];
        }

        return baseData;
    }, []);

    useEffect(() => {
        // Use setInterval instead of requestAnimationFrame so updates flush even when tab is backgrounded
        let intervalId: ReturnType<typeof setInterval>;
        const tick = () => {
            const update = pendingUpdateRef.current;
            if (update) {
                pendingUpdateRef.current = null;
                setRealtimeData(prev => applyUpdate(prev, update));
            }
        };
        intervalId = setInterval(tick, 100); // Flush max 10 times per second

        return () => {
            clearInterval(intervalId);
        };
    }, [applyUpdate]);

    // WebSocket logic for Crypto
    useEffect(() => {
        if (assetType !== 'crypto' || !symbol) return;

        // Cleanup previous connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        let reconnectTimeout: ReturnType<typeof setTimeout>;
        // Guard: if the effect has been cleaned up, don't reconnect
        let cancelled = false;
        // Fix #3.4 — Exponential backoff for WS reconnect
        let reconnectAttempt = 0;

        const connectWS = () => {
            if (cancelled) return;

            // Always read the latest symbol/interval from refs
            const currentSymbol = symbolRef.current;
            const currentInterval = intervalRef.current;
            const currentAssetType = assetTypeRef.current;

            // Don't reconnect if asset type changed away from crypto
            if (currentAssetType !== 'crypto') return;

            let pingTimeout: ReturnType<typeof setTimeout>;

            const resetPingTimeout = () => {
                clearTimeout(pingTimeout);
                // Backend sends JSON heartbeats every 25s; Binance klines can be quiet on 1d/1w.
                // 75s avoids false reconnects while still detecting dead sockets.
                pingTimeout = setTimeout(() => {
                    console.error(`[KLINE WS] Silent disconnect detected for ${currentSymbol}@${currentInterval} (no message for 75s). Forcing reconnect...`);
                    if (wsRef.current) wsRef.current.close();
                }, 75000);
            };

            const ws = new WebSocket(`${WS_URL}/market/ws/${currentSymbol}/${currentInterval}`);
            wsRef.current = ws;

            ws.onopen = () => {
                console.info(`[KLINE WS] Connected successfully to ${WS_URL}/market/ws/${currentSymbol}/${currentInterval}`);
                reconnectAttempt = 0; // Reset backoff on successful connection
                resetPingTimeout(); // Start watchdog
            };

            ws.onmessage = (event) => {
                resetPingTimeout();
                try {
                    const msg = JSON.parse(event.data) as Record<string, unknown>;
                    if (msg && msg.type === 'heartbeat') {
                        return;
                    }
                    pendingUpdateRef.current = msg as unknown as KlineData;
                } catch (e) {
                    console.error(`[KLINE WS] JSON parsing error for ${currentSymbol}@${currentInterval}:`, e, "Raw data:", event.data);
                }
            };

            ws.onerror = (err) => {
                console.error(`[KLINE WS] Connection error for ${currentSymbol}@${currentInterval}:`, err);
            };

            ws.onclose = (event) => {
                clearTimeout(pingTimeout); // Stop watchdog
                if (!cancelled) {
                    // Fix #3.4 — Exponential backoff: 3s, 6s, 12s, ..., max 30s
                    const delay = Math.min(3000 * Math.pow(2, reconnectAttempt), 30000);
                    reconnectAttempt++;
                    console.warn(`[KLINE WS] Closed for ${currentSymbol}@${currentInterval} with code: ${event.code}, reason: ${event.reason}. Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempt})`);
                    reconnectTimeout = setTimeout(connectWS, delay);
                } else {
                    console.info(`[KLINE WS] Closed cleanly for ${currentSymbol}@${currentInterval} (component unmounted/changed)`);
                }
            };
        };

        connectWS();

        return () => {
            cancelled = true;
            clearTimeout(reconnectTimeout);
            if (wsRef.current) {
                // Prevent auto-reconnect on legitimate unmount
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, [symbol, interval, assetType]);

    return {
        data: realtimeData || initialData,
        isLoading,
        isError: error
    };
}
