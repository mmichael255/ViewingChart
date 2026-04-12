import useSWR from 'swr';
import { useEffect, useState, useRef, useCallback } from 'react';
import { API_URL, WS_URL } from '@/config';
import type { KlineData } from '@/types/market';
import {
    RESYNC_AFTER_HIDDEN_MS,
    TRANSPORT_IDLE_KLINE_MS,
    klineMarketStaleThresholdMs,
} from '@/lib/connectionResilience';

export type WsStatus = 'connected' | 'disconnected' | 'reconnecting';

const fetcher = (url: string) => fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    return r.json();
});

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
    const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
    const wsRef = useRef<WebSocket | null>(null);

    // Refs to prevent stale closures in reconnect callbacks
    const symbolRef = useRef(symbol);
    const intervalRef = useRef(interval);
    const assetTypeRef = useRef(assetType);

    useEffect(() => { symbolRef.current = symbol; }, [symbol]);
    useEffect(() => { intervalRef.current = interval; }, [interval]);
    useEffect(() => { assetTypeRef.current = assetType; }, [assetType]);

    const initialDataRef = useRef<KlineData[]>([]);
    /** Avoid wiping on first mount — that runs after the initialData effect and empties the ref, so WS updates never apply */
    const prevChartKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (initialData) {
            initialDataRef.current = initialData;
            setRealtimeData(initialData);
        }
    }, [initialData]);

    // Reset realtime slice only when symbol / interval / asset actually change, not on initial mount
    useEffect(() => {
        const key = `${symbol}|${interval}|${assetType}`;
        const prev = prevChartKeyRef.current;
        if (prev === key) {
            return;
        }
        prevChartKeyRef.current = key;
        if (prev === null) {
            return;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRealtimeData(undefined);
        initialDataRef.current = [];
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
        let cancelled = false;
        let reconnectAttempt = 0;
        /** Transport: any frame including JSON heartbeat. */
        let transportTimeout: ReturnType<typeof setTimeout>;
        /** Market: last kline payload only (heartbeats do not reset). */
        let marketStaleTimeout: ReturnType<typeof setTimeout>;
        // Background tabs throttle timers and delay onmessage; silence watchdog would false-positive.
        let tabHidden =
            typeof document !== 'undefined' && document.visibilityState === 'hidden';
        let lastHiddenAt = 0;

        function clearTransportWatchdog() {
            clearTimeout(transportTimeout);
        }

        function clearMarketStaleWatchdog() {
            clearTimeout(marketStaleTimeout);
        }

        function armTransportWatchdog(currentSymbol: string, currentInterval: string) {
            clearTransportWatchdog();
            if (tabHidden || cancelled) return;
            transportTimeout = setTimeout(() => {
                if (tabHidden || cancelled) return;
                console.error(
                    `[KLINE WS] Transport idle for ${currentSymbol}@${currentInterval} (no frame for ${TRANSPORT_IDLE_KLINE_MS / 1000}s while tab visible). Forcing reconnect...`
                );
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.close();
                }
            }, TRANSPORT_IDLE_KLINE_MS);
        }

        function armMarketStaleWatchdog(currentSymbol: string, currentInterval: string) {
            clearMarketStaleWatchdog();
            if (tabHidden || cancelled) return;
            const ms = klineMarketStaleThresholdMs(currentInterval);
            marketStaleTimeout = setTimeout(() => {
                if (tabHidden || cancelled) return;
                console.warn(
                    `[KLINE WS] Market data stale for ${currentSymbol}@${currentInterval} (no candle for ${ms / 1000}s). REST resync...`
                );
                void mutate();
            }, ms);
        }

        function onVisibilityChange() {
            tabHidden = document.visibilityState === 'hidden';
            if (tabHidden) {
                lastHiddenAt = Date.now();
                clearTransportWatchdog();
                clearMarketStaleWatchdog();
            } else {
                const awayMs = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
                if (lastHiddenAt && awayMs >= RESYNC_AFTER_HIDDEN_MS) {
                    void mutate();
                }
                armTransportWatchdog(symbolRef.current, intervalRef.current);
                armMarketStaleWatchdog(symbolRef.current, intervalRef.current);
                const w = wsRef.current;
                if (w?.readyState === WebSocket.CLOSED && !cancelled) {
                    connectWS();
                }
            }
        }

        function connectWS() {
            if (cancelled) return;

            const currentSymbol = symbolRef.current;
            const currentInterval = intervalRef.current;
            const currentAssetType = assetTypeRef.current;

            if (currentAssetType !== 'crypto') return;

            const ws = new WebSocket(`${WS_URL}/market/ws/${currentSymbol}/${currentInterval}`);
            wsRef.current = ws;

            ws.onopen = () => {
                console.info(`[KLINE WS] Connected successfully to ${WS_URL}/market/ws/${currentSymbol}/${currentInterval}`);
                if (reconnectAttempt > 0) {
                    mutate();
                }
                reconnectAttempt = 0;
                setWsStatus('connected');
                armTransportWatchdog(currentSymbol, currentInterval);
                armMarketStaleWatchdog(currentSymbol, currentInterval);
            };

            ws.onmessage = (event) => {
                armTransportWatchdog(currentSymbol, currentInterval);
                try {
                    const msg = JSON.parse(event.data) as Record<string, unknown>;
                    if (msg && msg.type === 'heartbeat') {
                        return;
                    }
                    armMarketStaleWatchdog(currentSymbol, currentInterval);
                    pendingUpdateRef.current = msg as unknown as KlineData;
                } catch (e) {
                    console.error(`[KLINE WS] JSON parsing error for ${currentSymbol}@${currentInterval}:`, e, "Raw data:", event.data);
                }
            };

            ws.onerror = (err) => {
                console.error(`[KLINE WS] Connection error for ${currentSymbol}@${currentInterval}:`, err);
            };

            ws.onclose = (event) => {
                clearTransportWatchdog();
                clearMarketStaleWatchdog();
                if (!cancelled) {
                    setWsStatus('reconnecting');
                    const delay = Math.min(3000 * Math.pow(2, reconnectAttempt), 30000);
                    reconnectAttempt++;
                    console.warn(
                        `[KLINE WS] Closed for ${currentSymbol}@${currentInterval} with code: ${event.code}, reason: ${event.reason}. Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempt})`
                    );
                    reconnectTimeout = setTimeout(connectWS, delay);
                } else {
                    setWsStatus('disconnected');
                    console.info(`[KLINE WS] Closed cleanly for ${currentSymbol}@${currentInterval} (component unmounted/changed)`);
                }
            };
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
        connectWS();

        return () => {
            cancelled = true;
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
    }, [symbol, interval, assetType, mutate]);

    return {
        data: realtimeData || initialData,
        isLoading,
        isError: error,
        wsStatus: assetType === 'crypto' ? wsStatus : ('connected' as WsStatus),
    };
}
