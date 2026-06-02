export interface Bar {
  time: string | number;
  open: number; high: number; low: number; close: number; volume: number;
}

export function calcEMA(prices: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(period - 1).fill(null);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export function calcVWAP(bars: Bar[]): (number | null)[] {
  let cumTPV = 0, cumVol = 0;
  return bars.map((b) => {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumVol += b.volume;
    return cumVol > 0 ? cumTPV / cumVol : null;
  });
}

export function calcBollinger(prices: number[], period = 20, mult = 2) {
  const upper: (number | null)[] = [];
  const mid: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue; }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(mean + mult * std);
    mid.push(mean);
    lower.push(mean - mult * std);
  }
  return { upper, mid, lower };
}
