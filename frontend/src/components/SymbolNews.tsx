"use client";

import useSWR from "swr";
import { API_URL } from "@/config";

interface NewsItem {
    source: string;
    title: string;
    url: string;
    published_at: string;
    sentiment: string;
    description?: string;
}

interface SymbolNewsProps {
    symbol: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export const SymbolNews = ({ symbol }: SymbolNewsProps) => {
    const { data: news, error } = useSWR<NewsItem[]>(
        `${API_URL}/news/symbol/${encodeURIComponent(symbol)}`,
        fetcher,
        { refreshInterval: 300_000 }
    );

    if (error)
        return (
            <div className="px-4 py-3 border-b border-[#30363D]">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Related News
                </h3>
                <p className="text-[10px] text-gray-600 text-center py-4">Failed to load news</p>
            </div>
        );

    if (!news)
        return (
            <div className="px-4 py-3 border-b border-[#30363D]">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Related News
                </h3>
                <p className="text-[10px] text-gray-600 text-center py-4">Loading...</p>
            </div>
        );

    if (news.length === 0)

    return (
        <div className="px-4 py-3 border-b border-[#30363D]">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Related News
            </h3>
            <div className="space-y-2">
                {news.slice(0, 6).map((item, i) => (
                    <a
                        key={i}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block group"
                    >
                        <div className="flex items-start gap-2">
                            <span className="text-[9px] text-gray-500 shrink-0 mt-0.5">
                                {item.source}
                            </span>
                            <div className="min-w-0">
                                <p className="text-[10px] text-gray-300 group-hover:text-blue-400 leading-snug line-clamp-2 transition-colors">
                                    {item.title}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[8px] text-gray-600">
                                        {item.published_at?.slice(0, 16)}
                                    </span>
                                    {item.sentiment && item.sentiment !== "Neutral" && (
                                        <span
                                            className={`text-[8px] font-medium ${
                                                item.sentiment === "Bullish"
                                                    ? "text-green-400"
                                                    : item.sentiment === "Bearish"
                                                      ? "text-red-400"
                                                      : "text-gray-500"
                                            }`}
                                        >
                                            {item.sentiment}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </a>
                ))}
            </div>
        </div>
    );
};