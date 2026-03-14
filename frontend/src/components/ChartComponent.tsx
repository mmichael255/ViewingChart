/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { calculateSMA, calculateEMA, calculateBOLL, calculateSAR } from '../utils/indicators';
import type { KlineData } from '@/types/market';
import type { IndicatorConfig } from './IndicatorBar';
import { OscillatorPane } from './OscillatorPane';
import { DrawingManager } from '@/drawing';
import type { DrawingToolType, DrawingPoint, DrawingObject } from '@/drawing';
import { DrawingToolbar } from './DrawingToolbar';

interface ChartComponentProps {
    data: CandlestickData<Time>[];
    volumeData?: HistogramData<Time>[];
    symbol?: string;
    indicators?: IndicatorConfig[];
    activeTool?: DrawingToolType;
    onDrawingSelectionChange?: (drawing: DrawingObject | null) => void;
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
    activeTool = 'crosshair',
    onDrawingSelectionChange,
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
    const drawingManagerRef = useRef<DrawingManager>(new DrawingManager());

    const [selectedDrawing, setSelectedDrawing] = useState<DrawingObject | null>(null);

    // Legend State
    const [hoverLegendData, setHoverLegendData] = useState<any>(null);
    const [defaultLegendData, setDefaultLegendData] = useState<any>({});

    // Active UI Legend state prioritizes hover, falls back to static default
    const legendData = hoverLegendData || defaultLegendData;

    // Fix #5.2 — Track the indicator config signature so we only do a full rebuild
    // when indicators are added/removed/reconfigured, NOT on every data tick.
    const indicatorSignature = useMemo(() => {
        return JSON.stringify(indicators.map(i => ({ id: i.id, params: i.params })));
    }, [indicators]);

    // Memoize the format needed for the math utils
    const klineDataForMath = useMemo<KlineData[]>(() => {
        if (!data || !Array.isArray(data)) return [];
        const mapped = data.map((d) => {
            const raw = d as unknown as { time: string | number; open: string | number; high: string | number; low: string | number; close: string | number; };
            const timeValue = typeof raw.time === 'number' || !isNaN(Number(raw.time)) ?
                (typeof raw.time === 'number' ? raw.time : Number(raw.time)) as Time :
                String(raw.time) as Time;

            return {
                time: timeValue,
                open: Number(raw.open) || 0,
                high: Number(raw.high) || 0,
                low: Number(raw.low) || 0,
                close: Number(raw.close) || 0,
                volume: Number((raw as any).volume || (raw as any).vol) || 0
            };
        });

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

        // Attach DrawingManager
        drawingManagerRef.current.attach(chart, candlestickSeries);
        drawingManagerRef.current.onSelectionChange = () => {
            const drawing = drawingManagerRef.current.getSelectedDrawing();
            setSelectedDrawing(drawing);
            if (onDrawingSelectionChange) {
                onDrawingSelectionChange(drawing);
            }
        };

        return () => {
            drawingManagerRef.current.detach();
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
                // Calculate average time difference to extrapolate into the future natively
                let diff = 86400; // default to 1 day if not enough data
                if (validData.length >= 2) {
                    diff = Number(validData[validData.length - 1].time) - Number(validData[validData.length - 2].time);
                }

                // Add 150 whitespace candles (blank future space) native to lightweight-charts
                const futurePadding = [];
                const lastTime = Number(validData[validData.length - 1].time);
                for (let i = 1; i <= 150; i++) {
                    futurePadding.push({ time: (lastTime + diff * i) as Time });
                }

                const finalData = [...validData, ...futurePadding];
                candlestickSeriesRef.current.setData(finalData);
            }
        }
    }, [data]);

    // 2. Build/Rebuild Overlay Indicators — Fix #5.2
    // This effect only runs when indicators CONFIG changes (add/remove/param change).
    // It builds the series once and stores references for incremental updates.
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

        // --- Pre-create series for each active overlay ---
        const activeMAs = indicators.filter(ind => ind.id === 'ma');
        const activeEMAs = indicators.filter(ind => ind.id === 'ema');
        const activeBoll = indicators.find(ind => ind.id === 'boll');
        const activeSar = indicators.find(ind => ind.id === 'sar');

        const maColors = ['#2962FF', '#FF6D00', '#00C853', '#E91E63', '#9C27B0', '#00BCD4', '#FFEB3B', '#FF5722', '#3F51B5', '#8BC34A'];
        const emaColors = ['#FFD600', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#3F51B5', '#8BC34A', '#2962FF', '#FF6D00', '#00C853'];

        activeMAs.forEach((ma) => {
            const periods = Array.isArray(ma.params?.periods) ? ma.params.periods : [20];
            periods.forEach((p: number, pIdx: number) => {
                const color = maColors[pIdx % maColors.length];
                const series = chart.addSeries(LineSeries, { color, lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
                if (!indicatorSeriesRefs.current[ma.id]) indicatorSeriesRefs.current[ma.id] = [];
                indicatorSeriesRefs.current[ma.id].push(series);
            });
        });

        activeEMAs.forEach((ema) => {
            const periods = Array.isArray(ema.params?.periods) ? ema.params.periods : [20];
            periods.forEach((p: number, pIdx: number) => {
                const color = emaColors[pIdx % emaColors.length];
                const series = chart.addSeries(LineSeries, { color, lineWidth: 1, crosshairMarkerVisible: false, lineStyle: 1, lastValueVisible: false, priceLineVisible: false });
                if (!indicatorSeriesRefs.current[ema.id]) indicatorSeriesRefs.current[ema.id] = [];
                indicatorSeriesRefs.current[ema.id].push(series);
            });
        });

        if (activeBoll) {
            const upper = chart.addSeries(LineSeries, { color: 'rgba(41, 98, 255, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const middle = chart.addSeries(LineSeries, { color: 'rgba(255, 255, 255, 0.4)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            const lower = chart.addSeries(LineSeries, { color: 'rgba(41, 98, 255, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            indicatorSeriesRefs.current[activeBoll.id] = [upper, middle, lower];
        }

        if (activeSar) {
            const series = chart.addSeries(LineSeries, { color: '#E91E63', lineWidth: 2, lineStyle: 3, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
            indicatorSeriesRefs.current[activeSar.id] = [series];
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [indicatorSignature]);

    // 2.5 Update indicator DATA — runs when data changes OR indicators change.
    // This uses setData on existing series instead of destroying & recreating them.
    useEffect(() => {
        if (!chartRef.current || klineDataForMath.length === 0) return;

        const activeMAs = indicators.filter(ind => ind.id === 'ma');
        const activeEMAs = indicators.filter(ind => ind.id === 'ema');
        const activeBoll = indicators.find(ind => ind.id === 'boll');
        const activeSar = indicators.find(ind => ind.id === 'sar');

        const newDefaultLegend: any = {};
        if (klineDataForMath.length > 0) {
            const last = klineDataForMath[klineDataForMath.length - 1];
            newDefaultLegend.time = String(last.time);
            newDefaultLegend.open = last.open;
            newDefaultLegend.high = last.high;
            newDefaultLegend.low = last.low;
            newDefaultLegend.close = last.close;
        }

        // Update MA series data
        activeMAs.forEach((ma) => {
            const periods = Array.isArray(ma.params?.periods) ? ma.params.periods : [20];
            const seriesList = indicatorSeriesRefs.current[ma.id] || [];
            periods.forEach((p: number, pIdx: number) => {
                if (seriesList[pIdx]) {
                    const res = calculateSMA(klineDataForMath, p).filter(d => !isNaN(d.value));
                    if (res.length > 0) newDefaultLegend[`${ma.name}_${pIdx}`] = res[res.length - 1].value;
                    seriesList[pIdx].setData(res.map(d => ({ time: d.time as Time, value: d.value })));
                }
            });
        });

        // Update EMA series data
        activeEMAs.forEach((ema) => {
            const periods = Array.isArray(ema.params?.periods) ? ema.params.periods : [20];
            const seriesList = indicatorSeriesRefs.current[ema.id] || [];
            periods.forEach((p: number, pIdx: number) => {
                if (seriesList[pIdx]) {
                    const res = calculateEMA(klineDataForMath, p).filter(d => !isNaN(d.value));
                    if (res.length > 0) newDefaultLegend[`${ema.name}_${pIdx}`] = res[res.length - 1].value;
                    seriesList[pIdx].setData(res.map(d => ({ time: d.time as Time, value: d.value })));
                }
            });
        });

        // Update BOLL series data
        if (activeBoll) {
            const p = (activeBoll.params?.period as number) || 20;
            const m = (activeBoll.params?.multiplier as number) || 2;
            const res = calculateBOLL(klineDataForMath, p, m);
            const seriesList = indicatorSeriesRefs.current[activeBoll.id] || [];

            if (res.length > 0) {
                const last = res[res.length - 1];
                newDefaultLegend[`${activeBoll.name}_0`] = last.upper;
                newDefaultLegend[`${activeBoll.name}_1`] = last.middle;
                newDefaultLegend[`${activeBoll.name}_2`] = last.lower;
            }

            if (seriesList[0]) seriesList[0].setData(res.filter(d => !isNaN(d.upper)).map(d => ({ time: d.time as Time, value: d.upper })));
            if (seriesList[1]) seriesList[1].setData(res.filter(d => !isNaN(d.middle)).map(d => ({ time: d.time as Time, value: d.middle })));
            if (seriesList[2]) seriesList[2].setData(res.filter(d => !isNaN(d.lower)).map(d => ({ time: d.time as Time, value: d.lower })));
        }

        // Update SAR series data
        if (activeSar) {
            const step = (activeSar.params?.step as number) || 0.02;
            const maxStep = (activeSar.params?.maxStep as number) || 0.2;
            const res = calculateSAR(klineDataForMath, step, maxStep);
            const seriesList = indicatorSeriesRefs.current[activeSar.id] || [];

            if (res.length > 0) newDefaultLegend[`${activeSar.name}_0`] = res[res.length - 1].value;

            if (seriesList[0]) seriesList[0].setData(res.filter(d => !isNaN(d.value)).map(d => ({ time: d.time as Time, value: d.value })));
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDefaultLegendData(newDefaultLegend);

    }, [data, indicators, klineDataForMath]);

    // 3. Reset Zoom on asset switch + drawing persistence
    useEffect(() => {
        if (chartRef.current && symbol) {
            chartRef.current.timeScale().fitContent();
            chartRef.current.priceScale('right').applyOptions({ autoScale: true });
            drawingManagerRef.current.setSymbol(symbol);
        }
    }, [symbol]);

    // 3.5 Sync active drawing tool
    useEffect(() => {
        drawingManagerRef.current.setTool(activeTool);
    }, [activeTool]);

    // 3.6 Chart click handler for drawing
    const handleChartClick = useCallback((param: any) => {
        if (!candlestickSeriesRef.current || !chartRef.current) return;
        if (!param.time || !param.point) return;

        // Convert pixel → chart coordinates
        const price = candlestickSeriesRef.current.coordinateToPrice(param.point.y);
        if (price === null) return;
        const time = param.time as Time;

        const drawingPoint: DrawingPoint = { time, price };
        drawingManagerRef.current.handleClick(drawingPoint);
    }, []);

    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.subscribeClick(handleChartClick);
        return () => {
            chartRef.current?.unsubscribeClick(handleChartClick);
        };
    }, [handleChartClick]);

    // 3.7 Mouse move for drawing preview
    useEffect(() => {
        if (!chartRef.current) return;
        const chart = chartRef.current;

        const handleMove = (param: any) => {
            if (!candlestickSeriesRef.current || !param.point || !param.time) return;
            const price = candlestickSeriesRef.current.coordinateToPrice(param.point.y);
            if (price === null) return;
            const time = param.time as Time;
            drawingManagerRef.current.handleMouseMove({ time, price });
        };

        chart.subscribeCrosshairMove(handleMove);
        return () => {
            chart.unsubscribeCrosshairMove(handleMove);
        };
    }, []);

    // 3.8 Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                drawingManagerRef.current.cancelDrawing();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                drawingManagerRef.current.removeSelected();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // 3.9 Native drag handlers for drawings
    useEffect(() => {
        const container = chartContainerRef.current;
        if (!container) return;

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 || !chartRef.current) return;
            const rect = container.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const handled = drawingManagerRef.current.handleMouseDown(px, py);
            if (handled) {
                e.stopPropagation();
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!chartRef.current) return;
            const rect = container.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            const handled = drawingManagerRef.current.handleDrag(px, py);
            if (handled) {
                e.stopPropagation();
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (!chartRef.current) return;
            const handled = drawingManagerRef.current.endDrag();
            if (handled) {
                e.stopPropagation();
            }
        };

        // Use capture phase to intercept before lightweight-charts panning
        container.addEventListener('mousedown', handleMouseDown, { capture: true });
        window.addEventListener('mousemove', handleMouseMove, { capture: true });
        window.addEventListener('mouseup', handleMouseUp, { capture: true });

        return () => {
            container.removeEventListener('mousedown', handleMouseDown, { capture: true });
            window.removeEventListener('mousemove', handleMouseMove, { capture: true });
            window.removeEventListener('mouseup', handleMouseUp, { capture: true });
        };
    }, []);

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
                        const vals = Object.keys(legendData)
                            .filter(k => k.startsWith(ind.name + '_'))
                            .map(k => legendData[k]);

                        if (vals.length === 0) return null;

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

                {/* ── DRAWING TOOLBAR OVERLAY ── */}
                {selectedDrawing && (
                    <DrawingToolbar
                        drawing={selectedDrawing}
                        onUpdateStyle={(style) => {
                            drawingManagerRef.current.updateSelectedStyle(style);
                            setSelectedDrawing(drawingManagerRef.current.getSelectedDrawing());
                        }}
                        onDelete={() => {
                            drawingManagerRef.current.removeSelected();
                            setSelectedDrawing(null);
                        }}
                    />
                )}

                <div
                    ref={chartContainerRef}
                    className="w-full h-full absolute inset-0"
                />
            </div>

            {/* Draw active oscillator panes underneath the main chart */}
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
