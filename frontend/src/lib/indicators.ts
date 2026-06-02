export interface Bar {
  time: string | number;
  open: number; high: number; low: number; close: number; volume: number;
}

// ── Moving Averages ────────────────────────────────────────────────────────────

export function calcEMA(prices: number[], period: number): (number | null)[] {
  if (prices.length < period) return prices.map(() => null);
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

export function calcSMA(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    return prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

export function calcWMA(prices: number[], period: number): (number | null)[] {
  const denom = (period * (period + 1)) / 2;
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    let s = 0;
    for (let j = 0; j < period; j++) s += prices[i - period + 1 + j] * (j + 1);
    return s / denom;
  });
}

export function calcDEMA(prices: number[], period: number): (number | null)[] {
  const ema1 = calcEMA(prices, period);
  const start = period - 1;
  const ema1nums = ema1.slice(start) as number[];
  const ema2 = calcEMA(ema1nums, period);
  const out: (number | null)[] = new Array(prices.length).fill(null);
  for (let i = 0; i < ema2.length; i++) {
    if (ema2[i] !== null) out[start + i] = 2 * ema1nums[i] - (ema2[i] as number);
  }
  return out;
}

export function calcTEMA(prices: number[], period: number): (number | null)[] {
  const ema1 = calcEMA(prices, period);
  const s1 = period - 1;
  const ema2 = calcEMA(ema1.slice(s1) as number[], period);
  const s2 = s1 + period - 1;
  const ema3 = calcEMA((ema2.slice(period - 1) as number[]), period);
  const out: (number | null)[] = new Array(prices.length).fill(null);
  for (let i = 0; i < ema3.length; i++) {
    if (ema3[i] === null) continue;
    const e1 = ema1[s2 + i] as number;
    const e2 = ema2[(period - 1) + i] as number;
    const e3 = ema3[i] as number;
    out[s2 + i] = 3 * e1 - 3 * e2 + e3;
  }
  return out;
}

export function calcHMA(prices: number[], period: number): (number | null)[] {
  const halfP = Math.floor(period / 2);
  const sqrtP = Math.round(Math.sqrt(period));
  const wmaH = calcWMA(prices, halfP);
  const wmaF = calcWMA(prices, period);
  const diff = prices.map((_, i) => {
    const h = wmaH[i], f = wmaF[i];
    return h !== null && f !== null ? 2 * h - f : null;
  });
  const validStart = period - 1;
  const diffNums = (diff.slice(validStart) as (number | null)[]).map(v => v ?? 0);
  const hmaRaw = calcWMA(diffNums, sqrtP);
  const out: (number | null)[] = new Array(prices.length).fill(null);
  for (let i = 0; i < hmaRaw.length; i++) {
    if (hmaRaw[i] !== null) out[validStart + i] = hmaRaw[i];
  }
  return out;
}

export function calcVWMA(bars: Bar[], period: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i < period - 1) return null;
    let pv = 0, v = 0;
    for (let j = i - period + 1; j <= i; j++) { pv += bars[j].close * bars[j].volume; v += bars[j].volume; }
    return v > 0 ? pv / v : null;
  });
}

// ── VWAP / VWAP Bands ─────────────────────────────────────────────────────────

export function calcVWAP(bars: Bar[]): (number | null)[] {
  let cumTPV = 0, cumVol = 0;
  return bars.map((b) => {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumVol += b.volume;
    return cumVol > 0 ? cumTPV / cumVol : null;
  });
}

export function calcVWAPBands(bars: Bar[], stdMult: number): {
  vwap: (number | null)[]; upper: (number | null)[]; lower: (number | null)[];
} {
  let cumTPV = 0, cumTPV2 = 0, cumVol = 0;
  const vwap: (number | null)[] = [], upper: (number | null)[] = [], lower: (number | null)[] = [];
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumTPV2 += tp * tp * b.volume;
    cumVol += b.volume;
    const v = cumVol > 0 ? cumTPV / cumVol : null;
    vwap.push(v);
    if (v !== null && cumVol > 0) {
      const std = Math.sqrt(Math.max(0, cumTPV2 / cumVol - v * v));
      upper.push(v + stdMult * std);
      lower.push(v - stdMult * std);
    } else { upper.push(null); lower.push(null); }
  }
  return { vwap, upper, lower };
}

// ── Bollinger Bands ────────────────────────────────────────────────────────────

export function calcBollinger(prices: number[], period = 20, mult = 2) {
  const upper: (number | null)[] = [], mid: (number | null)[] = [], lower: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue; }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(mean + mult * std); mid.push(mean); lower.push(mean - mult * std);
  }
  return { upper, mid, lower };
}

// ── ATR (used by Keltner, Supertrend, ADX) ────────────────────────────────────

export function calcATR(bars: Bar[], period: number): (number | null)[] {
  if (bars.length < 2) return bars.map(() => null);
  // True range for each bar
  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder's smoothing (k = 1/period)
  const out: (number | null)[] = new Array(period - 1).fill(null);
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(atr);
  const k = 1 / period;
  for (let i = period; i < tr.length; i++) {
    atr = tr[i] * k + atr * (1 - k);
    out.push(atr);
  }
  return out;
}

// ── Keltner Channel ────────────────────────────────────────────────────────────

export function calcKeltner(bars: Bar[], period: number, mult: number): {
  upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[];
} {
  const mid = calcEMA(bars.map(b => b.close), period);
  const atr = calcATR(bars, period);
  return {
    upper: mid.map((m, i) => m !== null && atr[i] !== null ? m + mult * (atr[i] as number) : null),
    mid,
    lower: mid.map((m, i) => m !== null && atr[i] !== null ? m - mult * (atr[i] as number) : null),
  };
}

// ── Donchian Channel ───────────────────────────────────────────────────────────

export function calcDonchian(bars: Bar[], period: number): {
  upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[];
} {
  return {
    upper: bars.map((_, i) => i < period - 1 ? null : Math.max(...bars.slice(i - period + 1, i + 1).map(b => b.high))),
    lower: bars.map((_, i) => i < period - 1 ? null : Math.min(...bars.slice(i - period + 1, i + 1).map(b => b.low))),
    mid:   bars.map((_, i) => {
      if (i < period - 1) return null;
      const h = Math.max(...bars.slice(i - period + 1, i + 1).map(b => b.high));
      const l = Math.min(...bars.slice(i - period + 1, i + 1).map(b => b.low));
      return (h + l) / 2;
    }),
  };
}

// ── Supertrend ─────────────────────────────────────────────────────────────────

export function calcSupertrend(bars: Bar[], period: number, mult: number): {
  up: (number | null)[]; down: (number | null)[];
} {
  const atr = calcATR(bars, period);
  const up: (number | null)[] = new Array(bars.length).fill(null);
  const down: (number | null)[] = new Array(bars.length).fill(null);
  let prevUp = 0, prevDown = 0, trend = 1;

  for (let i = period; i < bars.length; i++) {
    const a = atr[i]; if (a === null) continue;
    const mid = (bars[i].high + bars[i].low) / 2;
    let upperB = mid + mult * a;
    let lowerB = mid - mult * a;
    if (lowerB < prevDown) lowerB = prevDown;
    if (upperB > prevUp) upperB = prevUp;
    if (bars[i].close > prevUp) trend = 1;
    else if (bars[i].close < prevDown) trend = -1;
    if (trend === 1) { up[i] = lowerB; } else { down[i] = upperB; }
    prevUp = upperB; prevDown = lowerB;
  }
  return { up, down };
}

// ── Parabolic SAR ─────────────────────────────────────────────────────────────

export function calcParabolicSAR(bars: Bar[], step: number, maxAF: number): (number | null)[] {
  if (bars.length < 2) return bars.map(() => null);
  const out: (number | null)[] = [null];
  let rising = true, ep = bars[0].high, af = step;
  let sar = bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    sar = sar + af * (ep - sar);
    if (rising) {
      sar = Math.min(sar, bars[Math.max(0, i - 1)].low, bars[Math.max(0, i - 2)].low);
      if (bars[i].low < sar) {
        rising = false; sar = ep; ep = bars[i].low; af = step;
      } else if (bars[i].high > ep) { ep = bars[i].high; af = Math.min(af + step, maxAF); }
    } else {
      sar = Math.max(sar, bars[Math.max(0, i - 1)].high, bars[Math.max(0, i - 2)].high);
      if (bars[i].high > sar) {
        rising = true; sar = ep; ep = bars[i].high; af = step;
      } else if (bars[i].low < ep) { ep = bars[i].low; af = Math.min(af + step, maxAF); }
    }
    out.push(sar);
  }
  return out;
}

// ── Ichimoku ───────────────────────────────────────────────────────────────────

export function calcIchimoku(bars: Bar[], tenkan: number, kijun: number, senkou: number): {
  tenkanSen: (number | null)[]; kijunSen: (number | null)[];
  spanA: (number | null)[]; spanB: (number | null)[];
} {
  const midpt = (i: number, n: number) => {
    if (i < n - 1) return null;
    const sl = bars.slice(i - n + 1, i + 1);
    return (Math.max(...sl.map(b => b.high)) + Math.min(...sl.map(b => b.low))) / 2;
  };
  const tenkanSen = bars.map((_, i) => midpt(i, tenkan));
  const kijunSen  = bars.map((_, i) => midpt(i, kijun));
  const spanA = bars.map((_, i) => {
    const t = tenkanSen[i], k = kijunSen[i];
    return t !== null && k !== null ? (t + k) / 2 : null;
  });
  const spanB = bars.map((_, i) => midpt(i, senkou));
  return { tenkanSen, kijunSen, spanA, spanB };
}

// ── RSI ────────────────────────────────────────────────────────────────────────

export function calcRSI(prices: number[], period: number): (number | null)[] {
  if (prices.length < period + 1) return prices.map(() => null);
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    gains.push(d > 0 ? d : 0); losses.push(d < 0 ? -d : 0);
  }
  const out: (number | null)[] = new Array(period).fill(null);
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}

// ── MACD ───────────────────────────────────────────────────────────────────────

export function calcMACD(prices: number[], fast: number, slow: number, signalP: number): {
  macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[];
} {
  const ef = calcEMA(prices, fast), es = calcEMA(prices, slow);
  const macdLine: (number | null)[] = prices.map((_, i) => {
    const f = ef[i], s = es[i]; return f !== null && s !== null ? f - s : null;
  });
  const slowStart = slow - 1;
  const macdNums = macdLine.slice(slowStart) as number[];
  const sigRaw = calcEMA(macdNums, signalP);
  const signalLine: (number | null)[] = new Array(prices.length).fill(null);
  for (let i = 0; i < sigRaw.length; i++) signalLine[slowStart + i] = sigRaw[i];
  const histogram = macdLine.map((m, i) => {
    const s = signalLine[i]; return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal: signalLine, histogram };
}

// ── Stochastic ─────────────────────────────────────────────────────────────────

export function calcStochastic(bars: Bar[], period: number, smooth: number): {
  k: (number | null)[]; d: (number | null)[];
} {
  const rawK: (number | null)[] = bars.map((b, i) => {
    if (i < period - 1) return null;
    const sl = bars.slice(i - period + 1, i + 1);
    const hi = Math.max(...sl.map(x => x.high)), lo = Math.min(...sl.map(x => x.low));
    return hi === lo ? 50 : ((b.close - lo) / (hi - lo)) * 100;
  });
  const kStart = period - 1;
  const kNums = rawK.slice(kStart) as number[];
  const kSmooth = calcSMA(kNums, smooth);
  const k: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < kSmooth.length; i++) k[kStart + i] = kSmooth[i];
  const kValid = (kSmooth.filter(v => v !== null)) as number[];
  const dRaw = calcSMA(kValid, smooth);
  const dStart = kStart + smooth - 1;
  const d: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < dRaw.length; i++) d[dStart + i] = dRaw[i];
  return { k, d };
}

// ── CCI ────────────────────────────────────────────────────────────────────────

export function calcCCI(bars: Bar[], period: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i < period - 1) return null;
    const sl = bars.slice(i - period + 1, i + 1);
    const tps = sl.map(b => (b.high + b.low + b.close) / 3);
    const mean = tps.reduce((a, b) => a + b, 0) / period;
    const meanDev = tps.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    return meanDev === 0 ? 0 : (tps[period - 1] - mean) / (0.015 * meanDev);
  });
}

// ── Williams %R ───────────────────────────────────────────────────────────────

export function calcWilliamsR(bars: Bar[], period: number): (number | null)[] {
  return bars.map((b, i) => {
    if (i < period - 1) return null;
    const sl = bars.slice(i - period + 1, i + 1);
    const hi = Math.max(...sl.map(x => x.high)), lo = Math.min(...sl.map(x => x.low));
    return hi === lo ? -50 : ((hi - b.close) / (hi - lo)) * -100;
  });
}

// ── ROC ────────────────────────────────────────────────────────────────────────

export function calcROC(prices: number[], period: number): (number | null)[] {
  return prices.map((p, i) => {
    if (i < period) return null;
    const prev = prices[i - period];
    return prev === 0 ? null : ((p - prev) / prev) * 100;
  });
}

// ── Momentum ───────────────────────────────────────────────────────────────────

export function calcMomentum(prices: number[], period: number): (number | null)[] {
  return prices.map((p, i) => i < period ? null : p - prices[i - period]);
}

// ── Z-Score ────────────────────────────────────────────────────────────────────

export function calcZScore(prices: number[], period: number): (number | null)[] {
  return prices.map((p, i) => {
    if (i < period - 1) return null;
    const sl = prices.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return std === 0 ? 0 : (p - mean) / std;
  });
}

// ── Aroon ──────────────────────────────────────────────────────────────────────

export function calcAroon(bars: Bar[], period: number): {
  up: (number | null)[]; down: (number | null)[];
} {
  const up: (number | null)[] = [], down: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period) { up.push(null); down.push(null); continue; }
    const sl = bars.slice(i - period, i + 1);
    const hiIdx = sl.reduce((mi, b, j) => b.high >= sl[mi].high ? j : mi, 0);
    const loIdx = sl.reduce((mi, b, j) => b.low <= sl[mi].low ? j : mi, 0);
    up.push((hiIdx / period) * 100);
    down.push((loIdx / period) * 100);
  }
  return { up, down };
}

// ── OBV ────────────────────────────────────────────────────────────────────────

export function calcOBV(bars: Bar[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = out[i - 1];
    if (bars[i].close > bars[i - 1].close) out.push(prev + bars[i].volume);
    else if (bars[i].close < bars[i - 1].close) out.push(prev - bars[i].volume);
    else out.push(prev);
  }
  return out;
}

// ── MFI ────────────────────────────────────────────────────────────────────────

export function calcMFI(bars: Bar[], period: number): (number | null)[] {
  const tps = bars.map(b => (b.high + b.low + b.close) / 3);
  const out: (number | null)[] = [null];
  for (let i = 1; i < bars.length; i++) {
    if (i < period) { out.push(null); continue; }
    let pos = 0, neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const mf = tps[j] * bars[j].volume;
      if (tps[j] > tps[j - 1]) pos += mf; else neg += mf;
    }
    out.push(neg === 0 ? 100 : 100 - 100 / (1 + pos / neg));
  }
  return out;
}

// ── CMF ────────────────────────────────────────────────────────────────────────

export function calcCMF(bars: Bar[], period: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i < period - 1) return null;
    const sl = bars.slice(i - period + 1, i + 1);
    let mfvSum = 0, volSum = 0;
    for (const b of sl) {
      const range = b.high - b.low;
      const mfm = range === 0 ? 0 : ((b.close - b.low) - (b.high - b.close)) / range;
      mfvSum += mfm * b.volume; volSum += b.volume;
    }
    return volSum === 0 ? 0 : mfvSum / volSum;
  });
}

// ── ADX ────────────────────────────────────────────────────────────────────────

export function calcADX(bars: Bar[], period: number): (number | null)[] {
  if (bars.length < period * 2) return bars.map(() => null);
  const tr: number[] = [], dmp: number[] = [], dmn: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, ph = bars[i-1].high, pl = bars[i-1].low, pc = bars[i-1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, dn = pl - l;
    dmp.push(up > dn && up > 0 ? up : 0);
    dmn.push(dn > up && dn > 0 ? dn : 0);
  }
  // Wilder's smoothed sum
  const ws = (arr: number[]) => {
    const r: number[] = [arr.slice(0, period).reduce((a, b) => a + b, 0)];
    for (let i = period; i < arr.length; i++) r.push(r[r.length - 1] - r[r.length - 1] / period + arr[i]);
    return r;
  };
  const wtr = ws(tr), wdmp = ws(dmp), wdmn = ws(dmn);
  const di_p = wtr.map((t, i) => t === 0 ? 0 : (wdmp[i] / t) * 100);
  const di_n = wtr.map((t, i) => t === 0 ? 0 : (wdmn[i] / t) * 100);
  const dx = di_p.map((p, i) => {
    const s = p + di_n[i]; return s === 0 ? 0 : (Math.abs(p - di_n[i]) / s) * 100;
  });
  // Wilder's smooth of DX for ADX
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const adxVals: number[] = [adxVal];
  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    adxVals.push(adxVal);
  }
  const offset = period * 2 - 1;
  const out: (number | null)[] = new Array(offset).fill(null);
  return out.concat(adxVals);
}

// ── Std Dev ────────────────────────────────────────────────────────────────────

export function calcStdDev(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const sl = prices.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    return Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  });
}
