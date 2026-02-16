import useSWR from 'swr';
import { Time } from 'lightweight-charts';

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
    // In dev, Next.js runs on 3000, FastAPI on 8000
    // We should probably use an environment variable for the API URL
    const API_URL = 'http://localhost:8000';

    const { data, error, isLoading } = useSWR<KlineData[]>(
        `${API_URL}/market/klines/${symbol}?interval=${interval}&asset_type=${assetType}`,
        fetcher,
        {
            refreshInterval: 60000, // Poll every minute
        }
    );

    return {
        data: data,
        isLoading,
        isError: error
    };
}
