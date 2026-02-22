"use client";

import React, { useEffect, useState, useRef } from 'react';

interface PriceHighlightProps {
    price: number | string;
    className?: string;
    disableColors?: boolean;
}

export const PriceHighlight: React.FC<PriceHighlightProps> = ({
    price,
    className = "",
    disableColors = false
}) => {
    const currentPriceStr = typeof price === 'number' ? price.toFixed(2) : String(price);

    // We use a ref to track the "previous" price from the *last* render cycle
    const lastPriceRef = useRef(currentPriceStr);

    // comparisonsBase is the price we are diffing against
    const [comparisonBase, setComparisonBase] = useState(currentPriceStr);
    const [direction, setDirection] = useState<"up" | "down" | null>(null);
    const [tickKey, setTickKey] = useState(0);

    // Logic: When we receive a NEW price that differs from our Ref
    // We handle the state update in useEffect to avoid side-effects during render (except purely derived state, but we have blink keys)

    useEffect(() => {
        if (currentPriceStr !== lastPriceRef.current) {
            const oldPrice = lastPriceRef.current;
            const isUp = Number(currentPriceStr) >= Number(oldPrice);

            // Ignore transition from 0 or "0.00" (initial load) to a real price
            const isInitialLoad = Number(oldPrice) === 0;

            lastPriceRef.current = currentPriceStr;

            if (!isInitialLoad) {
                // Normal update
                // We purposefully trigger a state update here because we need the UI to flash
                // based on the new tick's relation to the old price.
                setComparisonBase(oldPrice);
                setDirection(isUp ? "up" : "down");
                setTickKey(prev => prev + 1);
            } else {
                setComparisonBase(currentPriceStr);
                setDirection(null);
            }
        }
    }, [currentPriceStr]);

    const isStable = currentPriceStr === comparisonBase || disableColors;
    const isUp = direction === "up" || Number(currentPriceStr) >= Number(comparisonBase);
    const colorClass = isUp ? 'text-green-400' : 'text-red-400';
    const blinkClass = direction === "up" ? "blink-green" : (direction === "down" ? "blink-red" : "");

    // 1. Stable / Initial State
    if (isStable) {
        return (
            <span key={tickKey} className={`${className} ${blinkClass} text-white px-1 rounded transition-colors duration-300`}>
                {currentPriceStr}
            </span>
        );
    }

    // 2. Partial Highlight Logic
    let firstDiffIndex = -1;
    const len = Math.min(currentPriceStr.length, comparisonBase.length);
    for (let i = 0; i < len; i++) {
        if (currentPriceStr[i] !== comparisonBase[i]) {
            firstDiffIndex = i;
            break;
        }
    }

    // Structural mismatch fallback
    if (firstDiffIndex === -1 || currentPriceStr.length !== comparisonBase.length) {
        return (
            <span key={tickKey} className={`${className} ${blinkClass} ${colorClass} px-1 rounded transition-colors duration-300`}>
                {currentPriceStr}
            </span>
        );
    }

    return (
        <span key={tickKey} className={`${className} ${blinkClass} text-white px-1 rounded transition-colors duration-300`}>
            {currentPriceStr.split('').map((char, i) => {
                const isAfterDiff = i >= firstDiffIndex;
                return (
                    <span key={i} className={isAfterDiff ? colorClass : 'text-white'}>
                        {char}
                    </span>
                );
            })}
        </span>
    );
};
