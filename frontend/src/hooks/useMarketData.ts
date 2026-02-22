import useSWR from 'swr';
import { Time } from 'lightweight-charts';
import { useEffect, useState, useRef } from 'react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export interface KlineData {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export function useMarketData(symbol: string, interval: string = '1d', assetType: string = 'crypto') {
    const API_URL = 'http://localhost:8000';
    const WS_URL = 'ws://localhost:8000';

    // Fetch initial data
    const { data: initialData, error, isLoading, mutate } = useSWR<KlineData[]>(
        `${API_URL}/market/klines/${symbol}?interval=${interval}&asset_type=${assetType}`,
        fetcher,
        {
            refreshInterval: assetType === 'stock' ? 60000 : 0, // Poll stocks only, WS handles crypto
            revalidateOnFocus: false
        }
    );

    // Fallback: If no realtime data yet, use SWR's initialData directly in the render cycle rather than syncing via effect
    const [realtimeData, setRealtimeData] = useState<KlineData[] | undefined>(undefined);
    const wsRef = useRef<WebSocket | null>(null);

    const initialDataRef = useRef<KlineData[]>([]);
    useEffect(() => {
        if (initialData) initialDataRef.current = initialData;
    }, [initialData]);

    // Track when initial data changes to optionally reset realtime data if symbol changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
        setRealtimeData(undefined);
    }, [symbol, interval, assetType]);

    // WebSocket logic for Crypto
    useEffect(() => {
        if (assetType !== 'crypto' || !symbol) return;

        // Cleanup previous connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        const ws = new WebSocket(`${WS_URL}/market/ws/${symbol}/${interval}`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log(`Connected to WS for ${symbol}`);
        };

        ws.onmessage = (event) => {
            const update: KlineData = JSON.parse(event.data);

            setRealtimeData(currentData => {
                const baseData = currentData || initialDataRef.current;
                if (!baseData || baseData.length === 0) return [update];

                const lastCandle = baseData[baseData.length - 1];

                // If update time is same as last candle, update it (tick)
                // If update time is newer, append it (new candle)
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
            console.error("WebSocket error:", err);
        };

        return () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
    }, [symbol, interval, assetType]);

    return {
        data: realtimeData || initialData,
        isLoading,
        isError: error
    };
}
