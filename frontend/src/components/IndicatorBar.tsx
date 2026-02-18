import React from 'react';

export const IndicatorBar: React.FC = () => {
    return (
        <div className="flex items-center bg-[#131722] text-gray-400 text-[10px] select-none overflow-x-auto scrollbar-none border-t border-gray-800 h-7 shrink-0">
            <div className="indicator-list flex items-center px-1 w-full relative">
                <ul className="main flex items-center gap-3 whitespace-nowrap mr-8">
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ma">MA</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ema">EMA</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="boll">BOLL</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="td">TD</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="bbi">BBI</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ai-largeorder">AI-Whale Orders</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="vpvr">Volume Profile</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ichimoku">Ichimoku</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="sar">SAR</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="alligator">Alligator</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="dc">DC</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="kc">KC</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ene">ENE</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ai-aggtrade">AI-Large Trades</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="onchain">OnChain Inflows</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="kol-tracking">KOL Tracking</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="liqmap">Liquidation Map</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ai-srl">AI-SRL</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ai-fd">AI-FD</li>

                    <div className="more-indicators relative inline-flex items-center ml-1">
                        <button type="button" className="icon more hover:text-white transition-colors">
                            <svg width="13" height="12" viewBox="0 0 13 12"><path d="M5 2l3.2929 3.2929c.3905.3905.3905 1.0237 0 1.4142L5 10" stroke="currentColor" fill="none" fillRule="evenodd" strokeLinecap="round"></path></svg>
                        </button>
                    </div>
                </ul>

                {/* Separator or Sub-list could go here if needed, keeping it simple based on provided HTML structure */}
                <div className="w-px h-3 bg-gray-700 mx-2 shrink-0"></div>

                <ul className="sub flex items-center gap-3 whitespace-nowrap">
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="volume">VOLUME</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="position">Position</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="macd">MACD</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="rsi">RSI</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="kdj">KDJ</li>
                    <li className="hover:text-[#2962FF] cursor-pointer transition-colors" data-indic-key="ai-li">AI-LI</li>
                </ul>

                <div className="flex-1"></div>

                <button type="button" className="icon editor-indicator-btn ml-auto hover:text-white transition-colors p-1">
                    <svg width="14" height="14" viewBox="0 0 16 16"><g fill="currentColor" fillRule="evenodd"><path d="M12.583 8h.917v5.5h-11v-11H8v.917H3.417v9.166h9.166z"></path><path fillRule="nonzero" d="M6.9096 8.353l6.1709-6.171.7714.7715-6.1709 6.171z"></path></g></svg>
                </button>
            </div>
        </div>
    );
};
