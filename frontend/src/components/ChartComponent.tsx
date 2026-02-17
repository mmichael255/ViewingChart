"use client";

import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import React, { useEffect, useRef, useState } from 'react';

interface ChartComponentProps {
    data: CandlestickData<Time>[];
    volumeData?: HistogramData<Time>[];
    symbol?: string; // Track symbol changes to reset zoom
    colors?: {
        backgroundColor?: string;
        lineColor?: string;
        textColor?: string;
        areaTopColor?: string;
        areaBottomColor?: string;
    };
}

export const ChartComponent: React.FC<ChartComponentProps> = ({ 
    data, 
    volumeData,
    symbol,
    colors = {
        backgroundColor: '#1E222D', // TradingView Dark
        lineColor: '#2962FF',
        textColor: '#D9D9D9',
        areaTopColor: '#2962FF',
        areaBottomColor: 'rgba(41, 98, 255, 0.28)',
    }
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

    // 1. Initialize Chart (Run once)
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: colors.backgroundColor },
                textColor: colors.textColor,
            },
            width: chartContainerRef.current.clientWidth,
            height: 500,
            grid: {
                vertLines: { color: '#2B2B43' },
                horzLines: { color: '#2B2B43' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });
        chartRef.current = chart;

        // Create Series
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });
        candlestickSeriesRef.current = candlestickSeries;

        // Create Volume Series
        // Note: checking volumeData existence here is tricky if it comes later. 
        // Better to always create the series if we expect it, or handle it dynamically.
        // For now, let's assume if the component is used, we want volume capabilities.
        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '', // Set as an overlay
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
        });
        volumeSeriesRef.current = volumeSeries;

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []); // Empty dependency array -> Runs once on mount!

    // 2. Update Data (Run whenever data changes)
    useEffect(() => {
        if (candlestickSeriesRef.current && data) {
            // Validate data before setting
            if (Array.isArray(data)) {
                const validData = data.filter(d => d && d.time !== undefined);
                if (validData.length > 0) {
                    candlestickSeriesRef.current.setData(validData);
                }
            } else {
                console.warn("Chart data is not an array:", data);
            }
        }
        if (volumeSeriesRef.current && volumeData) {
             volumeSeriesRef.current.setData(volumeData);
        }
    }, [data, volumeData]);

    // 3. Reset Zoom when symbol changes
    useEffect(() => {
        if (chartRef.current && symbol) {
            // Reset time scale zoom
            chartRef.current.timeScale().fitContent();
            
            // Reset price scale zoom for both candlestick and volume
            if (candlestickSeriesRef.current) {
                chartRef.current.priceScale('right').applyOptions({
                    autoScale: true
                });
            }
        }
    }, [symbol]);

    return (
        <div 
            ref={chartContainerRef} 
            className="w-full h-[500px] relative"
        />
    );
};
