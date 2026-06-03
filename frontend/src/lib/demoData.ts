/* Seeded deterministic demo data for landing page charts.
   Uses mulberry32 RNG — same seed always produces same bars. */

export interface OhlcBar {
  time: string; // YYYY-MM-DD
  open: number; high: number; low: number; close: number; volume: number;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate n daily OHLC bars ending today (most-recent last) */
export function genBars(n: number, seed: number, opts?: {
  start?: number; drift?: number; vol?: number; amp?: number; period?: number;
}): OhlcBar[] {
  const rnd = mulberry32(seed);
  const start  = opts?.start  ?? 100;
  const drift  = opts?.drift  ?? 0.12;
  const vol    = opts?.vol    ?? 1.0;
  const amp    = opts?.amp    ?? 1.2;
  const period = opts?.period ?? 9;

  const bars: OhlcBar[] = [];
  let price = start;

  // Build dates ending "today" relative to a fixed anchor (stable)
  const anchor = new Date("2026-06-03");
  for (let i = 0; i < n; i++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - (n - 1 - i));
    const dateStr = d.toISOString().slice(0, 10);

    const wave = Math.sin(i / period) * amp * 0.18;
    const o = price;
    const move = (rnd() - 0.5) * 2 * vol + drift + wave;
    const c = Math.max(2, o + move);
    const hi = Math.max(o, c) + rnd() * vol * 0.9;
    const lo = Math.min(o, c) - rnd() * vol * 0.9;
    const v = 0.5 + rnd();
    bars.push({ time: dateStr, open: o, high: hi, low: lo, close: c, volume: v });
    price = c;
  }
  return bars;
}

/** EMA of closes */
export function demoEMA(bars: OhlcBar[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | undefined;
  bars.forEach((b, i) => {
    prev = i === 0 ? b.close : b.close * k + prev! * (1 - k);
    out.push(prev);
  });
  return out;
}

/** SMA of closes */
export function demoSMA(bars: OhlcBar[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/** Bollinger Bands */
export function demoBollinger(bars: OhlcBar[], period = 20, std = 2): {
  upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[];
} {
  const mid = demoSMA(bars, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (bars[j].close - mid[i]!) ** 2;
    const sd = Math.sqrt(s / period);
    upper.push(mid[i]! + std * sd);
    lower.push(mid[i]! - std * sd);
  }
  return { upper, mid, lower };
}

/** VWAP (cumulative) */
export function demoVWAP(bars: OhlcBar[]): number[] {
  let cumPV = 0, cumV = 0;
  return bars.map(b => {
    const tp = (b.high + b.low + b.close) / 3;
    cumPV += tp * b.volume;
    cumV  += b.volume;
    return cumPV / cumV;
  });
}

// ── Pre-baked datasets used across multiple landing sections ─────────────────

/** Hero mini-chart: 60 bars of SPY-ish price ~540-580 */
export const HERO_BARS = genBars(60, 7,  { start: 540, drift: 0.42, vol: 3.4, amp: 2.0, period: 11 });

/** Strategy RSI chart: 54 bars, mean-reverting */
export const STRAT_RSI_BARS = genBars(54, 21, { start: 100, drift: 0,    vol: 1.6, amp: 3.2, period: 7  });

/** Strategy EMA chart: 54 bars, trending up */
export const STRAT_EMA_BARS = genBars(54, 33, { start: 100, drift: 0.5,  vol: 1.4, amp: 1.6, period: 14 });

/** Strategy VWAP chart: 50 bars */
export const STRAT_VWAP_BARS = genBars(50, 51, { start: 100, drift: 0.34, vol: 1.5, amp: 1.4, period: 9  });

/** Charting demo: 80 bars ~SPY-ish price ~420 */
export const CHART_BARS = genBars(80, 99, { start: 420, drift: 0.34, vol: 3.0, amp: 2.4, period: 13 });

/** Backtest equity curve: 90 data points starting from 10 000 */
export function genEquityCurve(): { idx: number; value: number }[] {
  const rnd = mulberry32(123);
  const pts: { idx: number; value: number }[] = [];
  let v = 10000;
  for (let i = 0; i < 90; i++) {
    v *= 1 + (rnd() - 0.46) * 0.022;
    pts.push({ idx: i, value: Math.round(v * 100) / 100 });
  }
  return pts;
}
