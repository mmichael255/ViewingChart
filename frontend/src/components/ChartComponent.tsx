"use client";

import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import React, { useEffect, useRef } from 'react';

interface ChartComponentProps {
    data: CandlestickData<Time>[];
    volumeData?: HistogramData<Time>[];
    symbol?: string;
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
        backgroundColor: '#1E222D',
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

    // 1. Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const container = chartContainerRef.current;
        const observer = new ResizeObserver(() => {
            if (chartRef.current && container) {
                chartRef.current.applyOptions({
                    width: container.clientWidth,
                    height: container.clientHeight
                });
            }
        });
        observer.observe(container);

        const chart = createChart(container, {
            layout: {
                background: { type: ColorType.Solid, color: colors.backgroundColor },
                textColor: colors.textColor,
            },
            width: container.clientWidth,
            height: container.clientHeight,
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

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });
        candlestickSeriesRef.current = candlestickSeries;

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });
        volumeSeriesRef.current = volumeSeries;

        return () => {
            observer.disconnect();
            chart.remove();
            chartRef.current = null;
        };
    }, [colors.backgroundColor, colors.textColor]);

    // 2. Update Data
    useEffect(() => {
        if (candlestickSeriesRef.current && data && Array.isArray(data)) {
            const validData = data.filter(d => d && d.time !== undefined);
            if (validData.length > 0) {
                candlestickSeriesRef.current.setData(validData);
            }
        }
        if (volumeSeriesRef.current && volumeData && Array.isArray(volumeData)) {
            volumeSeriesRef.current.setData(volumeData);
        }
    }, [data, volumeData]);

    // 3. Reset Zoom
    useEffect(() => {
        if (chartRef.current && symbol) {
            chartRef.current.timeScale().fitContent();
            chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        }
    }, [symbol]);

    return (
        <div
            ref={chartContainerRef}
            className="w-full h-full relative"
        />
    );
};
