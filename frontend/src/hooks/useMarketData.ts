import useSWR from 'swr';
import { Time } from 'lightweight-charts';
import { useEffect, useState, useRef } from 'react';
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

        const connectWS = () => {
            if (cancelled) return;

            // Always read the latest symbol/interval from refs
            const currentSymbol = symbolRef.current;
            const currentInterval = intervalRef.current;
            const currentAssetType = assetTypeRef.current;

            // Don't reconnect if asset type changed away from crypto
            if (currentAssetType !== 'crypto') return;

            const ws = new WebSocket(`${WS_URL}/market/ws/${currentSymbol}/${currentInterval}`);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log(`Connected to WS for ${currentSymbol}`);
            };

            ws.onmessage = (event) => {
                const update: KlineData = JSON.parse(event.data);

                setRealtimeData(currentData => {
                    const baseData = currentData || initialDataRef.current;

                    if (!baseData || baseData.length === 0) return currentData;

                    const lastCandle = baseData[baseData.length - 1];

                    if (lastCandle.time === update.time) {
                        const newData = [...baseData];
                        newData[newData.length - 1] = update;
                        return newData;
                    } else if (update.time > lastCandle.time) {
                        return [...baseData, update];
                    }

                    return baseData;
                });
            };

            ws.onerror = (err) => {
                console.error(`WebSocket error for ${currentSymbol}:`, err);
            };

            ws.onclose = () => {
                if (!cancelled) {
                    console.log(`WebSocket closed for ${currentSymbol}. Reconnecting in 3 seconds...`);
                    reconnectTimeout = setTimeout(connectWS, 3000);
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
