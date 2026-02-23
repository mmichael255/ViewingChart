/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { calculateSMA, calculateEMA, calculateBOLL, calculateSAR, KlineData } from '../utils/indicators';
import type { IndicatorConfig } from './IndicatorBar';
import { OscillatorPane } from './OscillatorPane';

interface ChartComponentProps {
    data: CandlestickData<Time>[];
    volumeData?: HistogramData<Time>[];
    symbol?: string;
    indicators?: IndicatorConfig[];
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
    indicators = [],
    colors = {
        backgroundColor: '#1E222D',
        lineColor: '#2962FF',
        textColor: '#D9D9D9',
        areaTopColor: '#2962FF',
        areaBottomColor: 'rgba(41, 98, 255, 0.28)',
    }
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const indicatorSeriesRefs = useRef<{ [id: string]: ISeriesApi<"Line" | "Histogram">[] }>({});

    // Legend State
    const [hoverLegendData, setHoverLegendData] = useState<any>(null);
    const [defaultLegendData, setDefaultLegendData] = useState<any>({});

    // Active UI Legend state prioritizes hover, falls back to static default
    const legendData = hoverLegendData || defaultLegendData;

    // Memoize the format needed for the math utils (needs Open, High, Low, Close, Volume)
    // We approximate it using just the candlestick data since lightweight-charts CandlestickData has open, high, low, close.
    const klineDataForMath = useMemo<KlineData[]>(() => {
        if (!data || !Array.isArray(data)) return [];
        const mapped = data.map((d) => {
            const raw = d as unknown as { time: string | number; open: string | number; high: string | number; low: string | number; close: string | number; };
            // Lightweight charts expects time as either a string 'YYYY-MM-DD' or a UNIX timestamp (seconds since epoch) as a number
            // If it's a number, ensure it stays a number, if string, parse accordingly
            const timeValue = typeof raw.time === 'number' || !isNaN(Number(raw.time)) ?
                (typeof raw.time === 'number' ? raw.time : Number(raw.time)) as Time :
                String(raw.time) as Time;

            return {
                time: timeValue,
                open: Number(raw.open) || 0,
                high: Number(raw.high) || 0,
                low: Number(raw.low) || 0,
                close: Number(raw.close) || 0,
                // Handle different possible API property names for volume
                volume: Number((raw as any).volume || (raw as any).vol) || 0
            };
        });

        // Filter out rows without valid timestamps to satisfy KlineData restrictions
        return mapped.filter(d =>
            d.time !== undefined &&
            d.time !== null &&
            !(typeof d.time === 'number' && isNaN(d.time)) &&
            !(typeof d.time === 'string' && d.time.includes('NaN'))
        ) as unknown as (KlineData & { time: Time })[];
    }, [data]);

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
        setChartInstance(chart);

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
            setChartInstance(null);
        };
    }, [colors.backgroundColor, colors.textColor]);

    // 1.5 Update Base Series Data (Decoupled from indicators so it doesn't cause zoom resets on toggle)
    useEffect(() => {
        if (candlestickSeriesRef.current && data && Array.isArray(data)) {
            const validData = data
                .filter(d => d && d.time !== undefined && d.time !== null)
                .map(d => {
                    const t = typeof d.time === 'string' && !isNaN(Number(d.time)) ? Number(d.time) : d.time;
                    return { ...d, time: t as Time };
                });
            if (validData.length > 0) {
                candlestickSeriesRef.current.setData(validData);
            }
        }
    }, [data]);

    // 2. Update Overlay Indicators
    useEffect(() => {
        if (!chartRef.current) return;
        const chart = chartRef.current;

        // Clear previous generic indicator series
        Object.values(indicatorSeriesRefs.current).forEach(seriesList => {
            seriesList.forEach(s => {
                try { chart.removeSeries(s); } catch (e) { }
            });
        });
        indicatorSeriesRefs.current = {};

        // --- Handle Overlays ---
        const activeMAs = indicators.filter(ind => ind.id === 'ma');
        const activeEMAs = indicators.filter(ind => ind.id === 'ema');
        const activeBoll = indicators.find(ind => ind.id === 'boll');
        const activeSar = indicators.find(ind => ind.id === 'sar');

        const newDefaultLegend: any = {};
        if (klineDataForMath && klineDataForMath.length > 0) {
            const last = klineDataForMath[klineDataForMath.length - 1];
            newDefaultLegend.time = String(last.time);
            newDefaultLegend.open = last.open;
            newDefaultLegend.high = last.high;
            newDefaultLegend.low = last.low;
            newDefaultLegend.close = last.close;
        }

        activeMAs.forEach((ma) => {
            const periods = Array.isArray(ma.params?.periods) ? ma.params.periods : [20];
            periods.forEach((p: number, pIdx: number) => {
                const res = calculateSMA(klineDataForMath, p).filter(d => !isNaN(d.value));
                if (res.length > 0) newDefaultLegend[`${ma.name}_${pIdx}`] = res[res.length - 1].value;
                const colors = ['#2962FF', '#FF6D00', '#00C853', '#E91E63', '#9C27B0', '#00BCD4', '#FFEB3B', '#FF5722', '#3F51B5', '#8BC34A'];
                const color = colors[pIdx % colors.length];
                const series = chart.addSeries(LineSeries, { color, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
                series.setData(res.map(d => ({ time: d.time as Time, value: d.value })));
                if (!indicatorSeriesRefs.current[ma.id]) indicatorSeriesRefs.current[ma.id] = [];
                indicatorSeriesRefs.current[ma.id].push(series);
            });
        });

        activeEMAs.forEach((ema) => {
            const periods = Array.isArray(ema.params?.periods) ? ema.params.periods : [20];
            periods.forEach((p: number, pIdx: number) => {
                const res = calculateEMA(klineDataForMath, p).filter(d => !isNaN(d.value));
                if (res.length > 0) newDefaultLegend[`${ema.name}_${pIdx}`] = res[res.length - 1].value;
                const colors = ['#FFD600', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#3F51B5', '#8BC34A', '#2962FF', '#FF6D00', '#00C853'];
                const color = colors[pIdx % colors.length];
                const series = chart.addSeries(LineSeries, { color, lineWidth: 1, crosshairMarkerVisible: false, lineStyle: 1, lastValueVisible: false, priceLineVisible: false });
                series.setData(res.map(d => ({ time: d.time as Time, value: d.value })));
                if (!indicatorSeriesRefs.current[ema.id]) indicatorSeriesRefs.current[ema.id] = [];
                indicatorSeriesRefs.current[ema.id].push(series);
            });
        });

        if (activeBoll) {
            const p = (activeBoll.params?.period as number) || 20;
            const m = (activeBoll.params?.multiplier as number) || 2;
            const res = calculateBOLL(klineDataForMath, p, m);

            if (res.length > 0) {
                const last = res[res.length - 1];
                newDefaultLegend[`${activeBoll.name}_0`] = last.upper;
                newDefaultLegend[`${activeBoll.name}_1`] = last.middle;
                newDefaultLegend[`${activeBoll.name}_2`] = last.lower;
            }

            const upper = chart.addSeries(LineSeries, { color: 'rgba(41, 98, 255, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const middle = chart.addSeries(LineSeries, { color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const lower = chart.addSeries(LineSeries, { color: 'rgba(41, 98, 255, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });

            upper.setData(res.filter(d => !isNaN(d.upper)).map(d => ({ time: d.time as Time, value: d.upper })));
            middle.setData(res.filter(d => !isNaN(d.middle)).map(d => ({ time: d.time as Time, value: d.middle })));
            lower.setData(res.filter(d => !isNaN(d.lower)).map(d => ({ time: d.time as Time, value: d.lower })));

            indicatorSeriesRefs.current[activeBoll.id] = [upper, middle, lower];
        }

        if (activeSar) {
            const step = (activeSar.params?.step as number) || 0.02;
            const maxStep = (activeSar.params?.maxStep as number) || 0.2;
            const res = calculateSAR(klineDataForMath, step, maxStep);

            if (res.length > 0) newDefaultLegend[`${activeSar.name}_0`] = res[res.length - 1].value;

            const series = chart.addSeries(LineSeries, { color: '#E91E63', lineWidth: 2, lineStyle: 3, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            series.setData(res.filter(d => !isNaN(d.value)).map(d => ({ time: d.time as Time, value: d.value })));
            indicatorSeriesRefs.current[activeSar.id] = [series];
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDefaultLegendData(newDefaultLegend);

        // --- Handle Oscillators ---
        // We only render overlays on the main chart now. Oscillators are handled by the `<OscillatorPane />` mapped in the JSX.

    }, [data, indicators, klineDataForMath]);

    // 3. Reset Zoom on asset switch
    useEffect(() => {
        if (chartRef.current && symbol) {
            chartRef.current.timeScale().fitContent();
            chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        }
    }, [symbol]);

    // 4. Setup crosshair subscription
    useEffect(() => {
        if (chartRef.current && symbol) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handleCrosshairMove = (param: any) => {
                if (!param.time || !candlestickSeriesRef.current || param.point === undefined || param.point.x < 0 || param.point.y < 0) {
                    setHoverLegendData(null);
                    return;
                }
                const candleData = param.seriesData.get(candlestickSeriesRef.current) as KlineData | undefined;
                if (!candleData) return;

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const newLegendData: any = {
                    time: String(param.time),
                    open: candleData.open,
                    high: candleData.high,
                    low: candleData.low,
                    close: candleData.close
                };

                // Extract active indicator values under crosshair
                indicators.filter(i => i.type === 'overlay').forEach(ind => {
                    const seriesList = indicatorSeriesRefs.current[ind.id] || [];
                    seriesList.forEach((s, idx) => {
                        const val = param.seriesData.get(s) as { value?: number } | number | undefined;
                        if (val !== undefined) {
                            newLegendData[`${ind.name}_${idx}`] = typeof val === 'object' && val !== null ? val.value : val;
                        }
                    });
                });

                setHoverLegendData(newLegendData);
            };

            chartRef.current.subscribeCrosshairMove(handleCrosshairMove);
            return () => {
                chartRef.current?.unsubscribeCrosshairMove(handleCrosshairMove);
            };
        }
    }, [symbol, indicators]);

    const activeOscillators = indicators.filter(ind => ind.type === 'oscillator');

    const localVolumeData = useMemo(() => {
        return klineDataForMath.map(d => ({
            time: d.time as Time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        }));
    }, [klineDataForMath]);

    return (
        <div className="w-full h-full relative flex flex-col">
            <div className="w-full flex-1 relative">
                {/* ── LEGEND OVERLAY ── */}
                <div className="absolute top-2 left-4 z-20 pointer-events-none flex flex-col gap-1 text-[11px] font-medium tracking-tight whitespace-nowrap drop-shadow-md">
                    {legendData.close !== undefined && (
                        <div className="flex gap-2 items-center">
                            <span className="text-gray-400">O: <span className="text-white">{legendData.open?.toFixed(2)}</span></span>
                            <span className="text-gray-400">H: <span className="text-white">{legendData.high?.toFixed(2)}</span></span>
                            <span className="text-gray-400">L: <span className="text-white">{legendData.low?.toFixed(2)}</span></span>
                            <span className="text-gray-400">C: <span className={legendData.close >= (legendData.open || 0) ? 'text-[#26a69a]' : 'text-[#ef5350]'}>{legendData.close?.toFixed(2)}</span></span>
                        </div>
                    )}

                    {indicators.filter(i => i.type === 'overlay').map(ind => {
                        // Gather whatever values were recorded for this indicator ID in the legend state
                        const vals = Object.keys(legendData)
                            .filter(k => k.startsWith(ind.name + '_'))
                            .map(k => legendData[k]);

                        if (vals.length === 0) return null;

                        // Attempt to format the periods into the label if applicable
                        const periodArray = Array.isArray(ind.params?.periods) ? (ind.params?.periods as number[]) : [];
                        const titleLabel = periodArray.length > 0 ? `${ind.name} (${periodArray.join(', ')})` : ind.name;

                        return (
                            <div key={ind.id} className="flex gap-2 items-center text-gray-300">
                                <span className="font-bold">{titleLabel}</span>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                {vals.map((v: any, i) => {
                                    const getLegendColor = (id: string, index: number) => {
                                        if (id === 'ma') return ['#2962FF', '#FF6D00', '#00C853', '#E91E63', '#9C27B0', '#00BCD4', '#FFEB3B', '#FF5722', '#3F51B5', '#8BC34A'][index % 10];
                                        if (id === 'ema') return ['#FFD600', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#3F51B5', '#8BC34A', '#2962FF', '#FF6D00', '#00C853'][index % 10];
                                        if (id === 'boll') return ['#2962FF', '#FFFFFF', '#2962FF'][index % 3];
                                        if (id === 'sar') return '#E91E63';
                                        return `hsl(${index * 60}, 80%, 70%)`;
                                    };
                                    return <span key={i} style={{ color: getLegendColor(ind.id, i) }}>{typeof v === 'number' ? v.toFixed(2) : String(v)}</span>
                                })}
                            </div>
                        );
                    })}
                </div>

                <div
                    ref={chartContainerRef}
                    className="w-full h-full absolute inset-0"
                />
            </div>

            {/* Draw active oscillator panes underneath the main chart, passing the mainChart instance deeply so we can sync time scales. */}
            {chartInstance && activeOscillators.map(osc => (
                <OscillatorPane
                    key={osc.id}
                    indicator={osc}
                    klineDataForMath={klineDataForMath}
                    volumeData={osc.id === 'volume' ? localVolumeData : undefined}
                    mainChart={chartInstance}
                />
            ))}
        </div>
    );
};
