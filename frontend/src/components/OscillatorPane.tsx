"use client";

import { createChart, ColorType, IChartApi, ISeriesApi, Time, HistogramSeries, LineSeries } from 'lightweight-charts';
import React, { useEffect, useRef } from 'react';
import type { IndicatorConfig } from './IndicatorBar';
import { calculateMACD, calculateRSI, calculateKDJ, KlineData } from '../utils/indicators';

interface OscillatorPaneProps {
    indicator: IndicatorConfig;
    klineDataForMath: KlineData[];
    volumeData?: { time: Time, value: number, color?: string }[];
    mainChart: IChartApi | null;
}

export const OscillatorPane: React.FC<OscillatorPaneProps> = ({
    indicator,
    klineDataForMath,
    volumeData,
    mainChart
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const subChartRef = useRef<IChartApi | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const chart = createChart(container, {
            layout: {
                background: { type: ColorType.Solid, color: '#1E222D' },
                textColor: '#D9D9D9',
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
                // Hide the timescale text on oscillators so they visually pack tighter (only Main chart shows dates)
                visible: false,
            },
        });
        subChartRef.current = chart;

        const observer = new ResizeObserver(() => {
            if (chart && container) {
                chart.applyOptions({
                    width: container.clientWidth,
                    height: container.clientHeight
                });
            }
        });
        observer.observe(container);

        // --- Crosshair and Zoom Sync ---
        if (mainChart) {
            // Sync Zoom/Pan from Main -> Sub
            mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (range) chart.timeScale().setVisibleLogicalRange(range);
            });
            // Sync Zoom/Pan from Sub -> Main
            chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (range) mainChart.timeScale().setVisibleLogicalRange(range);
            });

            // Sync Crosshair
            // NOTE: lightweight-charts type definitions don't expose `.series()` natively on the IChartApi interface
            // or `price` on param safely. We cast through `any` or use known structures to avoid TS errors.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mainChart.subscribeCrosshairMove((param: any) => {
                if (param.time) {
                    const price = param.point?.y || 0;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const series = (chart as any).series ? (chart as any).series()[0] : undefined;
                    if (series) chart.setCrosshairPosition(price, param.time, series);
                } else {
                    chart.clearCrosshairPosition();
                }
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chart.subscribeCrosshairMove((param: any) => {
                if (param.time) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const series = (mainChart as any).series ? (mainChart as any).series()[0] : undefined;
                    if (series) mainChart.setCrosshairPosition(0, param.time, series);
                } else {
                    mainChart.clearCrosshairPosition();
                }
            });
        }

        // --- Draw specific indicator ---
        if (indicator.id === 'volume') {
            const volSeries = chart.addSeries(HistogramSeries, {
                priceFormat: { type: 'volume' },
                priceScaleId: '',
            });
            volSeries.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
            if (volumeData) {
                volSeries.setData(volumeData);
            }
        }
        else if (indicator.id === 'macd') {
            const fast = (indicator.params?.fast as number) || 12;
            const slow = (indicator.params?.slow as number) || 26;
            const sig = (indicator.params?.signal as number) || 9;
            const res = calculateMACD(klineDataForMath, fast, slow, sig);

            const macdSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, crosshairMarkerVisible: false });
            const signalSeries = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, crosshairMarkerVisible: false });
            const histSeries = chart.addSeries(HistogramSeries, {});

            macdSeries.setData(res.filter(d => !isNaN(d.macd)).map(d => ({ time: d.time as Time, value: d.macd })));
            signalSeries.setData(res.filter(d => !isNaN(d.signal)).map(d => ({ time: d.time as Time, value: d.signal })));
            histSeries.setData(res.filter(d => !isNaN(d.histogram)).map(d => ({
                time: d.time as Time,
                value: d.histogram,
                color: d.histogram >= 0 ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
            })));
        }
        else if (indicator.id === 'rsi') {
            const p = (indicator.params?.period as number) || 14;
            const res = calculateRSI(klineDataForMath, p);
            const rsiSeries = chart.addSeries(LineSeries, { color: '#9C27B0', lineWidth: 2, crosshairMarkerVisible: false });
            rsiSeries.setData(res.filter(d => !isNaN(d.value)).map(d => ({ time: d.time as Time, value: d.value })));
        }
        else if (indicator.id === 'kdj') {
            const n = (indicator.params?.n as number) || 9;
            const m1 = (indicator.params?.m1 as number) || 3;
            const m2 = (indicator.params?.m2 as number) || 3;
            const res = calculateKDJ(klineDataForMath, n, m1, m2);

            const kSeries = chart.addSeries(LineSeries, { color: '#FFD600', lineWidth: 1, crosshairMarkerVisible: false });
            const dSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, crosshairMarkerVisible: false });
            const jSeries = chart.addSeries(LineSeries, { color: '#E91E63', lineWidth: 1, crosshairMarkerVisible: false });

            kSeries.setData(res.filter(d => !isNaN(d.k)).map(d => ({ time: d.time as Time, value: d.k })));
            dSeries.setData(res.filter(d => !isNaN(d.d)).map(d => ({ time: d.time as Time, value: d.d })));
            jSeries.setData(res.filter(d => !isNaN(d.j)).map(d => ({ time: d.time as Time, value: d.j })));
        }

        return () => {
            observer.disconnect();
            chart.remove();
            subChartRef.current = null;
        };
    }, [indicator, klineDataForMath, volumeData, mainChart]);

    return (
        <div className="w-full h-32 relative border-t border-gray-800 shrink-0 flex flex-col">
            {/* Subpane Header label */}
            <div className="absolute top-1 left-4 z-20 pointer-events-none text-xs font-bold text-gray-500 bg-[#1E222D]/50 px-1 rounded">
                {indicator.name}
            </div>
            <div ref={containerRef} className="w-full flex-1" />
        </div>
    );
};
