"use client";

import { useState } from "react";
import { Send, X, Zap, AlertTriangle, TrendingUp, ChevronDown, ChevronRight, Brain } from "lucide-react";

// ── Mock signal data — will be replaced by real agent engine ──

interface Signal {
    id: string;
    type: "entry" | "alert" | "info";
    symbol: string;
    symbolLabel: string;
    rating: number; // 1-5 stars
    headline: string;
    detail: string;
    confidence: string;
    timestamp: string;
    dismissed?: boolean;
}

const MOCK_SIGNALS: Signal[] = [
    {
        id: "1",
        type: "entry",
        symbol: "NVDA",
        symbolLabel: "NVIDIA",
        rating: 4,
        headline: "Bollinger squeeze forming on 4H",
        detail: "Price at lower band, RSI(14)=32 oversold, volume rising. Your Bollinger strategy triggered. Entry zone: $141-143. Stop: $138.20 (-2.7%). Target 1: $152 (+7.0%). Target 2: $158 (+11.2%). R:R = 2.6:1.",
        confidence: "71% win rate (your 14 past Bollinger trades)",
        timestamp: "2m ago",
    },
    {
        id: "2",
        type: "alert",
        symbol: "TSLA",
        symbolLabel: "Tesla",
        rating: 2,
        headline: "Broke 50-day MA support at $180",
        detail: "Currently $178.20, volume 2.3x average. NewsAPI shows delivery miss reports. Finnhub sentiment 34% bearish (down from 62%). Your support-break rule: reduce position by 50%. Your TSLA cost basis: $165. Still +8% unrealized.",
        confidence: "Based on your rule: close below 50MA for 2 candles → reduce",
        timestamp: "15m ago",
    },
    {
        id: "3",
        type: "info",
        symbol: "BTC",
        symbolLabel: "Bitcoin",
        rating: 3,
        headline: "Funding rate flipped negative (-0.008%)",
        detail: "Historically precedes a bounce 62% of the time in this range. CoinTelegraph reports SEC ETF decision delayed. Open interest flat — not a squeeze setup yet, but worth watching. Your last BTC entry was at $106k, current $108.4k (+2.3%).",
        confidence: "Based on Binance funding rate history (90 days)",
        timestamp: "1h ago",
    },
];

// ── Mock chat messages ──
interface ChatMessage {
    id: string;
    role: "agent" | "user";
    content: string;
}

const MOCK_CHAT: ChatMessage[] = [
    {
        id: "c1",
        role: "agent",
        content:
            "Morning. 4 signals on your watchlist. NVDA has the highest confidence setup — Bollinger squeeze matching your best-performing strategy. Want me to analyze any specific symbol?",
    },
];

export const AgentPanel = () => {
    const [signals, setSignals] = useState<Signal[]>(MOCK_SIGNALS);
    const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
    const [chatMessages] = useState<ChatMessage[]>(MOCK_CHAT);
    const [chatInput, setChatInput] = useState("");

    const dismissSignal = (id: string) => {
        setSignals((prev) => prev.filter((s) => s.id !== id));
        setExpandedSignal((e) => (e === id ? null : e));
    };

    const toggleExpand = (id: string) => {
        setExpandedSignal((e) => (e === id ? null : id));
    };

    const handleSend = () => {
        if (!chatInput.trim()) return;
        // TODO: wire to real agent API
        setChatInput("");
    };

    const typeColors: Record<Signal["type"], string> = {
        entry: "text-green-400 bg-green-400/10 border-green-400/30",
        alert: "text-red-400 bg-red-400/10 border-red-400/30",
        info: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    };

    const typeIcons: Record<Signal["type"], React.ReactNode> = {
        entry: <TrendingUp size={14} />,
        alert: <AlertTriangle size={14} />,
        info: <Zap size={14} />,
    };

    const visibleSignals = signals.filter((s) => !s.dismissed);

    return (
        <div className="flex flex-col h-full bg-[#0D1117] border-r border-[#30363D] w-[320px] shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363D] shrink-0">
                <div className="flex items-center gap-2">
                    <Brain size={16} className="text-purple-400" />
                    <span className="text-sm font-semibold text-gray-200">
                        Agent
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400">
                        mock
                    </span>
                </div>
                <span className="text-[10px] text-gray-600">
                    {visibleSignals.length} signals
                </span>
            </div>

            {/* Signals */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 space-y-2">
                {visibleSignals.length === 0 && (
                    <p className="text-xs text-gray-600 text-center py-8">
                        No active signals. Agent is monitoring your watchlist.
                    </p>
                )}
                {visibleSignals.map((s) => {
                    const isExpanded = expandedSignal === s.id;
                    return (
                        <div
                            key={s.id}
                            className={`rounded-lg border ${typeColors[s.type]} p-2.5 text-xs transition-all`}
                        >
                            {/* Header row */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {typeIcons[s.type]}
                                    <span className="font-bold text-gray-200 truncate">
                                        {s.symbolLabel}
                                    </span>
                                    <span className="text-gray-500">
                                        {s.symbol}
                                    </span>
                                    <span className="text-yellow-400 text-[10px]">
                                        {"★".repeat(s.rating)}
                                        {"☆".repeat(5 - s.rating)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => toggleExpand(s.id)}
                                        className="text-gray-500 hover:text-gray-300 transition-colors"
                                    >
                                        {isExpanded ? (
                                            <ChevronDown size={14} />
                                        ) : (
                                            <ChevronRight size={14} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => dismissSignal(s.id)}
                                        className="text-gray-500 hover:text-gray-300 transition-colors"
                                        title="Dismiss"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Headline */}
                            <p className="mt-1 text-gray-300 font-medium leading-snug">
                                {s.headline}
                            </p>

                            {/* Expanded detail */}
                            {isExpanded && (
                                <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-2">
                                    <p className="text-gray-400 leading-relaxed">
                                        {s.detail}
                                    </p>
                                    <p className="text-[10px] text-gray-600 italic">
                                        Confidence: {s.confidence}
                                    </p>
                                    <div className="flex gap-2 pt-1">
                                        <button className="px-2 py-1 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-700 text-[10px] transition-colors">
                                            View Chart
                                        </button>
                                        <button className="px-2 py-1 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-700 text-[10px] transition-colors">
                                            View News
                                        </button>
                                        <button className="px-2 py-1 rounded bg-green-700/30 text-green-400 hover:bg-green-700/50 text-[10px] transition-colors">
                                            Log Trade
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Timestamp */}
                            <p className="mt-1.5 text-[9px] text-gray-600">
                                {s.timestamp}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* Chat section */}
            <div className="border-t border-[#30363D] shrink-0">
                {/* Chat messages */}
                <div className="px-2 py-2 max-h-[120px] overflow-y-auto space-y-1.5 bg-[#0D1117]/50">
                    {chatMessages.map((m) => (
                        <div key={m.id} className="text-[11px]">
                            <span className="text-purple-400 font-medium">
                                Agent:{" "}
                            </span>
                            <span className="text-gray-400 leading-relaxed">
                                {m.content}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Chat input */}
                <div className="flex items-center gap-1.5 px-2 py-2 border-t border-[#30363D]/50">
                    <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        placeholder="Ask about your watchlist..."
                        className="flex-1 bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                    />
                    <button
                        onClick={handleSend}
                        className="p-1.5 text-gray-500 hover:text-purple-400 transition-colors"
                    >
                        <Send size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};