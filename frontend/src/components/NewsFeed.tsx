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

export const NewsFeed = () => {
    const { data: news, error } = useSWR<NewsItem[]>("http://localhost:8000/news", fetcher);

    if (error) return <div className="text-red-500">Failed to load news</div>;
    if (!news) return <div className="text-gray-500">Loading news...</div>;

    return (
        <div className="w-full bg-[#1E222D] border border-gray-800 rounded-lg p-4 h-[500px] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-white">Latest News</h2>
            <div className="space-y-4">
                {news.map((item, idx) => (
                    <div key={idx} className="border-b border-gray-700 pb-3 last:border-0">
                        <div className="flex justify-between items-start mb-1">
                            <span className="text-xs text-gray-400">{item.source}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                                item.sentiment === 'Bullish' ? 'bg-green-900 text-green-200' : 
                                item.sentiment === 'Bearish' ? 'bg-red-900 text-red-200' : 'bg-gray-700 text-gray-300'
                            }`}>
                                {item.sentiment}
                            </span>
                        </div>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-400 hover:text-blue-300 block mb-1">
                            {item.title}
                        </a>
                        <span className="text-xs text-gray-500">{item.published_at}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
