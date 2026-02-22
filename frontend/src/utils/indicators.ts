export interface KlineData {
    time: number | string | Record<string, unknown>;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// 1. Simple Moving Average (SMA)
export function calculateSMA(data: KlineData[], period: number) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push({ time: data[i].time, value: NaN });
            continue;
        }
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        result.push({ time: data[i].time, value: sum / period });
    }
    return result;
}

// 2. Exponential Moving Average (EMA)
export function calculateEMA(data: KlineData[], period: number) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = data.length > 0 ? data[0].close : 0;

    for (let i = 0; i < data.length; i++) {
        if (i === 0) {
            result.push({ time: data[i].time, value: ema });
            continue;
        }
        ema = (data[i].close - ema) * k + ema;
        result.push({ time: data[i].time, value: ema });
    }
    return result;
}

// 3. Bollinger Bands (BOLL)
export function calculateBOLL(data: KlineData[], period: number = 20, multiplier: number = 2) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push({ time: data[i].time, upper: NaN, middle: NaN, lower: NaN });
            continue;
        }

        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        const middle = sum / period;

        let variance = 0;
        for (let j = 0; j < period; j++) {
            variance += Math.pow(data[i - j].close - middle, 2);
        }
        const stdDev = Math.sqrt(variance / period);

        result.push({
            time: data[i].time,
            upper: middle + (stdDev * multiplier),
            middle: middle,
            lower: middle - (stdDev * multiplier)
        });
    }
    return result;
}

// 4. Parabolic SAR (PSAR)
export function calculateSAR(data: KlineData[], step: number = 0.02, maxStep: number = 0.2) {
    const result: { time: number | string | Record<string, unknown>; value: number; isLong: boolean }[] = [];
    if (data.length < 2) return result;

    let isLong = true;
    let sar = data[0].low;
    let ep = data[0].high;
    let af = step;

    for (let i = 0; i < data.length; i++) {
        const cur = data[i];

        if (i > 0) {
            const prev = data[i - 1];
            sar = sar + af * (ep - sar);

            if (isLong) {
                if (cur.low < sar) {
                    isLong = false;
                    sar = ep;
                    ep = cur.low;
                    af = step;
                } else {
                    if (cur.high > ep) {
                        ep = cur.high;
                        af = Math.min(af + step, maxStep);
                    }
                    if (i > 1 && data[i - 2].low < sar) sar = data[i - 2].low;
                    if (prev.low < sar) sar = prev.low;
                }
            } else {
                if (cur.high > sar) {
                    isLong = true;
                    sar = ep;
                    ep = cur.high;
                    af = step;
                } else {
                    if (cur.low < ep) {
                        ep = cur.low;
                        af = Math.min(af + step, maxStep);
                    }
                    if (i > 1 && data[i - 2].high > sar) sar = data[i - 2].high;
                    if (prev.high > sar) sar = prev.high;
                }
            }
        }

        result.push({ time: cur.time, value: sar, isLong });
    }
    return result;
}

// 5. Relative Strength Index (RSI)
export function calculateRSI(data: KlineData[], period: number = 14) {
    const result: { time: number | string | Record<string, unknown>; value: number }[] = [];
    if (data.length < period + 1) return result;

    let gains = 0, losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = data[i].close - data[i - 1].close;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = 0; i < data.length; i++) {
        if (i < period) {
            result.push({ time: data[i].time, value: NaN });
            continue;
        }

        if (i > period) {
            const diff = data[i].close - data[i - 1].close;
            const curGain = diff >= 0 ? diff : 0;
            const curLoss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + curGain) / period;
            avgLoss = (avgLoss * (period - 1) + curLoss) / period;
        }

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));

        result.push({ time: data[i].time, value: rsi });
    }
    return result;
}

// 6. MACD
export function calculateMACD(data: KlineData[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) {
    const fastEma = calculateEMA(data, fastPeriod);
    const slowEma = calculateEMA(data, slowPeriod);

    const macdLine = [];
    for (let i = 0; i < data.length; i++) {
        const val = (!isNaN(fastEma[i].value) && !isNaN(slowEma[i].value)) ? fastEma[i].value - slowEma[i].value : NaN;
        macdLine.push({ time: data[i].time, value: val, close: data[i].close });
    }

    const cleanMacdForEma = macdLine.filter(m => !isNaN(m.value) && m.value !== undefined).map(m => ({ time: m.time, close: m.value, open: 0, high: 0, low: 0, volume: 0 }) as KlineData);
    const signalLineRaw = calculateEMA(cleanMacdForEma, signalPeriod);

    // Pad signal line back to original length
    const signalLine = Array(data.length - cleanMacdForEma.length).fill({ value: NaN }).concat(signalLineRaw);

    const result = [];
    for (let i = 0; i < data.length; i++) {
        const m = macdLine[i].value;
        const s = signalLine[i] ? signalLine[i].value : NaN;
        const h = (!isNaN(m) && !isNaN(s)) ? m - s : NaN;
        result.push({
            time: data[i].time,
            macd: m,
            signal: s,
            histogram: h
        });
    }
    return result;
}

// 7. KDJ
export function calculateKDJ(data: KlineData[], n: number = 9, m1: number = 3, m2: number = 3) {
    const result = [];
    let prevK = 50;
    let prevD = 50;

    for (let i = 0; i < data.length; i++) {
        if (i < n - 1) {
            result.push({ time: data[i].time, k: NaN, d: NaN, j: NaN });
            continue;
        }

        let highestHigh = data[i].high;
        let lowestLow = data[i].low;

        for (let j = 0; j < n; j++) {
            highestHigh = Math.max(highestHigh, data[i - j].high);
            lowestLow = Math.min(lowestLow, data[i - j].low);
        }

        let rsv = 0;
        if (highestHigh !== lowestLow) {
            rsv = ((data[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;
        }

        const k = (1 / m1) * rsv + ((m1 - 1) / m1) * prevK;
        const d = (1 / m2) * k + ((m2 - 1) / m2) * prevD;
        const j = 3 * k - 2 * d;

        prevK = k;
        prevD = d;

        result.push({
            time: data[i].time,
            k: k,
            d: d,
            j: j
        });
    }
    return result;
}
