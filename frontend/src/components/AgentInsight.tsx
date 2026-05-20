"use client";

import { Brain, TrendingUp } from "lucide-react";

interface AgentInsightProps {
    symbol: string;
    symbolName?: string;
}

// Mock insights per symbol — will be replaced by real agent API
const MOCK_INSIGHTS: Record<string, { headline: string; detail: string }> = {
    BTCUSDT: {
        headline: "Funding rate flipped negative — historically precedes a bounce",
        detail:
            "Binance funding rate for BTC is -0.008%. In the last 90 days, negative funding preceded a bounce 62% of the time within 48 hours. Open interest is flat at $15.2B — not a squeeze setup yet, but worth watching. Your last BTC entry at $106k is currently +2.3%.",
    },
    NVDA: {
        headline: "Bollinger squeeze forming — your best-performing pattern",
        detail:
            "Price at lower Bollinger Band on 4H, RSI(14) oversold at 32, volume rising. You've traded this pattern 14 times with 71% win rate. When DXY is below 100 (currently 99.1), your win rate rises to 83%.",
    },
    TSLA: {
        headline: "Broke 50-day MA support — your rule says reduce",
        detail:
            "TSLA closed below 50-day MA for 2 consecutive candles at $180. Your support-break rule: reduce position by 50%. Current price $178.20, cost basis $165 — still +8% unrealized.",
    },
};

const DEFAULT_INSIGHT = {
    headline: "Agent monitoring your watchlist",
    detail:
        "No specific signals for this symbol yet. The agent scans for setups matching your strategy rules and will surface them here. Add this symbol to your watchlist and log trades to improve the agent's recommendations.",
};

export const AgentInsight = ({ symbol, symbolName }: AgentInsightProps) => {
    const insight =
        MOCK_INSIGHTS[symbol] ??
        MOCK_INSIGHTS[symbol.replace("-USD", "USDT")] ??
        DEFAULT_INSIGHT;

    return (
        <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
                <Brain size={14} className="text-purple-400" />
                <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
                    Agent Insight
                </h3>
                <span className="text-[8px] px-1 py-0.5 rounded bg-purple-400/10 text-purple-400/70">
                    mock
                </span>
            </div>
            <div className="bg-purple-400/5 border border-purple-400/10 rounded-lg p-3">
                <div className="flex items-start gap-2">
                    <TrendingUp
                        size={14}
                        className="text-purple-400 mt-0.5 shrink-0"
                    />
                    <div>
                        <p className="text-[11px] font-medium text-gray-200 leading-snug">
                            {insight.headline}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                            {insight.detail}
                        </p>
                    </div>
                </div>
                <button className="mt-2 text-[9px] text-purple-400 hover:text-purple-300 transition-colors">
                    View Full Analysis →
                </button>
            </div>
        </div>
    );
};