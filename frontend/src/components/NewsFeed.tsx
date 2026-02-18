"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface NewsItem {
    source: string;
    title: string;
    url: string;
    published_at: string;
    sentiment: string;
}

interface NewsFeedProps {
    compact?: boolean;
}

export const NewsFeed = ({ compact }: NewsFeedProps) => {
    const { data: news, error } = useSWR<NewsItem[]>("http://localhost:8000/news", fetcher);

    if (error) return <div className="p-4 text-red-500 text-xs text-center">Failed to load news</div>;
    if (!news) return <div className="p-4 text-gray-500 text-xs text-center animate-pulse">Loading news...</div>;

    return (
        <div className={`w-full bg-[#1E222D] ${compact ? '' : 'border border-gray-800 rounded-lg p-4 h-[500px] overflow-y-auto'}`}>
            {!compact && <h2 className="text-xl font-bold mb-4 text-white">Latest News</h2>}
            <div className={`space-y-4 ${compact ? 'p-3' : ''}`}>
                {news.map((item, idx) => (
                    <div key={idx} className="border-b border-gray-800 pb-3 last:border-0 hover:bg-gray-800/30 transition-colors cursor-pointer group rounded-sm p-1">
                        <div className="flex justify-between items-start mb-1 gap-2">
                            <span className="text-[10px] text-gray-500 truncate shrink">{item.source}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${item.sentiment === 'Bullish' ? 'bg-green-900/40 text-green-400' :
                                    item.sentiment === 'Bearish' ? 'bg-red-900/40 text-red-400' : 'bg-gray-700 text-gray-400'
                                }`}>
                                {item.sentiment}
                            </span>
                        </div>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-gray-200 group-hover:text-blue-400 line-clamp-2 leading-tight">
                            {item.title}
                        </a>
                        <div className="mt-1 flex justify-between items-center">
                            <span className="text-[9px] text-gray-600">{item.published_at}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
