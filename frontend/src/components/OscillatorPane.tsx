/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { createChart, ColorType, IChartApi, ISeriesApi, Time, HistogramSeries, LineSeries } from 'lightweight-charts';
import React, { useEffect, useRef, useState } from 'react';
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
    const seriesRefs = useRef<ISeriesApi<"Line" | "Histogram">[]>([]);
    const [hoverLegendData, setHoverLegendData] = useState<any>(null);
    const [defaultLegendData, setDefaultLegendData] = useState<any>({});

    const activeLegendData = hoverLegendData || defaultLegendData;

    // 1. Initialize Chart Instance
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

        // Local Crosshair Move
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handleLocalCrosshair = (param: any) => {
            if (param.time) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const series = (mainChart as any)?.series ? (mainChart as any).series()[0] : undefined;
                if (series && mainChart) mainChart.setCrosshairPosition(0, param.time, series);
            } else {
                if (mainChart) mainChart.clearCrosshairPosition();
            }

            if (!param.time || param.point === undefined || param.point.x < 0 || param.point.y < 0) {
                setHoverLegendData(null);
            } else {
                const newLegend: any = {};
                seriesRefs.current.forEach((s, idx) => {
                    const val = param.seriesData.get(s) as any;
                    if (val !== undefined) {
                        newLegend[`val_${idx}`] = typeof val === 'object' && val !== null ? val.value : val;
                    }
                });
                setHoverLegendData(newLegend);
            }
        };

        chart.subscribeCrosshairMove(handleLocalCrosshair);

        return () => {
            observer.disconnect();
            chart.unsubscribeCrosshairMove(handleLocalCrosshair);
            chart.remove();
            subChartRef.current = null;
        };
    }, [mainChart]);

    // 2. Sync crosshair/zoom with MainChart
    useEffect(() => {
        const chart = subChartRef.current;
        if (!mainChart || !chart) return;

        const handleSyncZoom = (range: any) => { if (range) chart.timeScale().setVisibleLogicalRange(range); };
        const handleSyncLocalZoom = (range: any) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handleMainCrosshairMove = (param: any) => {
            if (param.time) {
                const price = param.point?.y || 0;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const series = (chart as any).series ? (chart as any).series()[0] : undefined;
                if (series) chart.setCrosshairPosition(price, param.time, series);

                // Set local hover legend reading directly from local series' active memory via .data() match
                const newLegend: any = {};
                seriesRefs.current.forEach((s, i) => {
                    const dataVec = s.data();
                    const match = dataVec.find((d: any) => d.time === param.time) as any;
                    if (match) {
                        newLegend[`val_${i}`] = match.value !== undefined ? match.value : match;
                    }
                });
                setHoverLegendData(newLegend);
            } else {
                chart.clearCrosshairPosition();
                setHoverLegendData(null);
            }
        };

        mainChart.timeScale().subscribeVisibleLogicalRangeChange(handleSyncZoom);
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleSyncLocalZoom);
        mainChart.subscribeCrosshairMove(handleMainCrosshairMove);

        return () => {
            mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleSyncZoom);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleSyncLocalZoom);
            mainChart.unsubscribeCrosshairMove(handleMainCrosshairMove);
        };
    }, [mainChart]);

    // 3. Update Indicator Data
    useEffect(() => {
        const chart = subChartRef.current;
        if (!chart || klineDataForMath.length === 0) return;

        // Clean old series
        seriesRefs.current.forEach(s => {
            try { chart.removeSeries(s); } catch (e) { }
        });
        seriesRefs.current = [];

        const newDefaultLegend: any = {};

        if (indicator.id === 'volume') {
            const volSeries = chart.addSeries(HistogramSeries, {
                priceFormat: { type: 'volume' },
                lastValueVisible: false, priceLineVisible: false
            });
            volSeries.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
            if (volumeData && volumeData.length > 0) {
                volSeries.setData(volumeData);
                const last = volumeData[volumeData.length - 1];
                if (last) newDefaultLegend['val_0'] = last.value;
            }
            seriesRefs.current = [volSeries];
        }
        else if (indicator.id === 'macd') {
            const fast = (indicator.params?.fast as number) || 12;
            const slow = (indicator.params?.slow as number) || 26;
            const sig = (indicator.params?.signal as number) || 9;
            const res = calculateMACD(klineDataForMath, fast, slow, sig);

            if (res.length > 0) {
                const last = res[res.length - 1];
                newDefaultLegend['val_0'] = last.macd;
                newDefaultLegend['val_1'] = last.signal;
                newDefaultLegend['val_2'] = last.histogram;
            }

            const macdSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const signalSeries = chart.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const histSeries = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false });

            macdSeries.setData(res.filter(d => !isNaN(d.macd)).map(d => ({ time: d.time as Time, value: d.macd })));
            signalSeries.setData(res.filter(d => !isNaN(d.signal)).map(d => ({ time: d.time as Time, value: d.signal })));
            histSeries.setData(res.filter(d => !isNaN(d.histogram)).map(d => ({
                time: d.time as Time,
                value: d.histogram,
                color: d.histogram >= 0 ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
            })));
            seriesRefs.current = [macdSeries, signalSeries, histSeries];
        }
        else if (indicator.id === 'rsi') {
            const p = (indicator.params?.period as number) || 14;
            const res = calculateRSI(klineDataForMath, p);

            if (res.length > 0) newDefaultLegend['val_0'] = res[res.length - 1].value;

            const rsiSeries = chart.addSeries(LineSeries, { color: '#9C27B0', lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            rsiSeries.setData(res.filter(d => !isNaN(d.value)).map(d => ({ time: d.time as Time, value: d.value })));
            seriesRefs.current = [rsiSeries];
        }
        else if (indicator.id === 'kdj') {
            const n = (indicator.params?.n as number) || 9;
            const m1 = (indicator.params?.m1 as number) || 3;
            const m2 = (indicator.params?.m2 as number) || 3;
            const res = calculateKDJ(klineDataForMath, n, m1, m2);

            if (res.length > 0) {
                const last = res[res.length - 1];
                newDefaultLegend['val_0'] = last.k;
                newDefaultLegend['val_1'] = last.d;
                newDefaultLegend['val_2'] = last.j;
            }

            const kSeries = chart.addSeries(LineSeries, { color: '#FFD600', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const dSeries = chart.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const jSeries = chart.addSeries(LineSeries, { color: '#E91E63', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });

            kSeries.setData(res.filter(d => !isNaN(d.k)).map(d => ({ time: d.time as Time, value: d.k })));
            dSeries.setData(res.filter(d => !isNaN(d.d)).map(d => ({ time: d.time as Time, value: d.d })));
            jSeries.setData(res.filter(d => !isNaN(d.j)).map(d => ({ time: d.time as Time, value: d.j })));
            seriesRefs.current = [kSeries, dSeries, jSeries];
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDefaultLegendData(newDefaultLegend);
    }, [indicator, klineDataForMath, volumeData]);

    const renderLegendVars = () => {
        if (!activeLegendData) return null;
        if (indicator.id === 'volume') {
            const v = activeLegendData['val_0'];
            return <span className={v >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{typeof v === 'number' ? v.toFixed(2) : String(v || '')}</span>;
        }
        if (indicator.id === 'macd') {
            return (
                <div className="flex gap-2">
                    <span className="text-[#2962FF]">{typeof activeLegendData['val_0'] === 'number' ? activeLegendData['val_0'].toFixed(4) : ''}</span>
                    <span className="text-[#FF6D00]">{typeof activeLegendData['val_1'] === 'number' ? activeLegendData['val_1'].toFixed(4) : ''}</span>
                    <span className={activeLegendData['val_2'] >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{typeof activeLegendData['val_2'] === 'number' ? activeLegendData['val_2'].toFixed(4) : ''}</span>
                </div>
            );
        }
        if (indicator.id === 'rsi') {
            return <span className="text-[#9C27B0]">{typeof activeLegendData['val_0'] === 'number' ? activeLegendData['val_0'].toFixed(2) : ''}</span>;
        }
        if (indicator.id === 'kdj') {
            return (
                <div className="flex gap-2">
                    <span className="text-[#FFD600]">{typeof activeLegendData['val_0'] === 'number' ? activeLegendData['val_0'].toFixed(2) : ''}</span>
                    <span className="text-[#2962FF]">{typeof activeLegendData['val_1'] === 'number' ? activeLegendData['val_1'].toFixed(2) : ''}</span>
                    <span className="text-[#E91E63]">{typeof activeLegendData['val_2'] === 'number' ? activeLegendData['val_2'].toFixed(2) : ''}</span>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full h-32 relative border-t border-gray-800 shrink-0 flex flex-col">
            {/* Subpane Header label with Tracking Legend */}
            <div className="absolute top-1 left-4 z-20 pointer-events-none flex items-center gap-2 text-[11px] font-medium tracking-tight whitespace-nowrap drop-shadow-md bg-[#1E222D]/70 px-1.5 py-0.5 rounded">
                <span className="font-bold text-gray-400">{indicator.name}</span>
                {renderLegendVars()}
            </div>
            <div ref={containerRef} className="w-full flex-1" />
        </div>
    );
};
