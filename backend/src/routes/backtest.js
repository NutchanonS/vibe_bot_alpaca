const router = require("express").Router();
const axios = require("axios");

const DATA_URL = "https://data.alpaca.markets";

function getHeaders() {
  return {
    "APCA-API-KEY-ID":     process.env.ALPACA_MODE === "production" ? process.env.ALPACA_LIVE_API_KEY    : process.env.ALPACA_PAPER_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_MODE === "production" ? process.env.ALPACA_LIVE_SECRET_KEY : process.env.ALPACA_PAPER_SECRET_KEY,
  };
}

// ── Indicator math ─────────────────────────────────────────────────────────────

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  const out = Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function calcRSI(closes, period = 14) {
  const out = Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

// ── Strategy simulators ────────────────────────────────────────────────────────
// Each simulator: enters at next bar's open, exits at next bar's open.
// Returns array of trade objects.

function simRSI(bars, p = {}) {
  const { rsi_period = 14, oversold = 30, overbought = 70 } = p;
  const closes = bars.map(b => b.close);
  const rsi = calcRSI(closes, rsi_period);
  const trades = [];
  let pos = null;
  for (let i = rsi_period; i < bars.length - 1; i++) {
    if (rsi[i] === null) continue;
    if (!pos && rsi[i] < oversold) {
      pos = { entryTime: bars[i + 1].time, entryPrice: bars[i + 1].open };
    } else if (pos && rsi[i] > overbought) {
      const ep = bars[i + 1].open;
      trades.push({ ...pos, exitTime: bars[i + 1].time, exitPrice: ep, pnlPct: (ep - pos.entryPrice) / pos.entryPrice * 100 });
      pos = null;
    }
  }
  if (pos) {
    const lb = bars[bars.length - 1];
    trades.push({ ...pos, exitTime: lb.time, exitPrice: lb.close, pnlPct: (lb.close - pos.entryPrice) / pos.entryPrice * 100, open: true });
  }
  return trades;
}

function simEMA(bars, p = {}) {
  const { fast_period = 9, slow_period = 21, volume_multiplier = 1.2 } = p;
  const closes = bars.map(b => b.close);
  const vols   = bars.map(b => b.volume);
  const ef = calcEMA(closes, fast_period);
  const es = calcEMA(closes, slow_period);
  const trades = [];
  let pos = null;
  for (let i = slow_period; i < bars.length - 1; i++) {
    if (ef[i] === null || es[i] === null || ef[i-1] === null || es[i-1] === null) continue;
    const lb    = Math.min(20, i);
    const avgV  = vols.slice(i - lb, i).reduce((a, b) => a + b, 0) / lb;
    const crossUp = ef[i] > es[i] && ef[i-1] <= es[i-1];
    const crossDn = ef[i] < es[i] && ef[i-1] >= es[i-1];
    if (!pos && crossUp && vols[i] > avgV * volume_multiplier) {
      pos = { entryTime: bars[i+1].time, entryPrice: bars[i+1].open };
    } else if (pos && crossDn) {
      const ep = bars[i+1].open;
      trades.push({ ...pos, exitTime: bars[i+1].time, exitPrice: ep, pnlPct: (ep - pos.entryPrice) / pos.entryPrice * 100 });
      pos = null;
    }
  }
  if (pos) {
    const lb = bars[bars.length - 1];
    trades.push({ ...pos, exitTime: lb.time, exitPrice: lb.close, pnlPct: (lb.close - pos.entryPrice) / pos.entryPrice * 100, open: true });
  }
  return trades;
}

function simVWAP(bars, p = {}) {
  const { volume_zscore_threshold = 1.5, lookback_volume = 20 } = p;
  const closes = bars.map(b => b.close);
  const vols   = bars.map(b => b.volume);
  // Rolling VWAP using lookback window
  const vwap = bars.map((_, i) => {
    const lb    = Math.min(lookback_volume, i + 1);
    const slice = bars.slice(i - lb + 1, i + 1);
    const tv    = slice.reduce((s, x) => s + (x.high + x.low + x.close) / 3 * x.volume, 0);
    const sv    = slice.reduce((s, x) => s + x.volume, 0);
    return sv > 0 ? tv / sv : null;
  });
  const trades = [];
  let pos = null;
  for (let i = lookback_volume; i < bars.length - 1; i++) {
    if (vwap[i] === null) continue;
    const lb      = Math.min(lookback_volume, i);
    const vs      = vols.slice(i - lb, i);
    const avg     = vs.reduce((a, b) => a + b, 0) / vs.length;
    const std     = Math.sqrt(vs.reduce((s, v) => s + (v - avg) ** 2, 0) / vs.length);
    const zs      = std > 0 ? (vols[i] - avg) / std : 0;
    if (!pos && closes[i] > vwap[i] && zs > volume_zscore_threshold) {
      pos = { entryTime: bars[i+1].time, entryPrice: bars[i+1].open };
    } else if (pos && closes[i] < vwap[i]) {
      const ep = bars[i+1].open;
      trades.push({ ...pos, exitTime: bars[i+1].time, exitPrice: ep, pnlPct: (ep - pos.entryPrice) / pos.entryPrice * 100 });
      pos = null;
    }
  }
  if (pos) {
    const lb = bars[bars.length - 1];
    trades.push({ ...pos, exitTime: lb.time, exitPrice: lb.close, pnlPct: (lb.close - pos.entryPrice) / pos.entryPrice * 100, open: true });
  }
  return trades;
}

// ── Stats helpers ──────────────────────────────────────────────────────────────

function calcMaxDrawdown(curve) {
  if (curve.length === 0) return 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const { cumPnl } of curve) {
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDd) maxDd = dd;
  }
  return parseFloat(maxDd.toFixed(4));
}

function calcSharpe(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  return std > 0 ? parseFloat((mean / std).toFixed(2)) : 0;
}

// ── Stats ──────────────────────────────────────────────────────────────────────

function calcStats(trades) {
  const closed  = trades.filter(t => !t.open);
  const openT   = trades.filter(t => t.open);
  const wins    = closed.filter(t => t.pnlPct > 0);
  const losses  = closed.filter(t => t.pnlPct <= 0);
  const winPnl  = wins.reduce((s, t) => s + t.pnlPct, 0);
  const lossPnl = losses.reduce((s, t) => s + t.pnlPct, 0);
  const n       = closed.length;
  const pf      = Math.abs(lossPnl) > 0 ? winPnl / Math.abs(lossPnl) : (winPnl > 0 ? 99 : 0);
  let cum = 0;
  const curve = closed.map(t => { cum += t.pnlPct; return { time: t.exitTime, cumPnl: parseFloat(cum.toFixed(4)) }; });

  const totalPnlPct     = parseFloat((winPnl + lossPnl).toFixed(4));
  const maxDrawdownPct  = calcMaxDrawdown(curve);
  const unrealizedPnlPct = parseFloat(openT.reduce((s, t) => s + t.pnlPct, 0).toFixed(4));
  const sharpe          = calcSharpe(closed.map(t => t.pnlPct));
  const bestTradePct    = closed.length > 0 ? parseFloat(Math.max(...closed.map(t => t.pnlPct)).toFixed(4)) : 0;
  const worstTradePct   = closed.length > 0 ? parseFloat(Math.min(...closed.map(t => t.pnlPct)).toFixed(4)) : 0;

  return {
    totalTrades:    n,
    openTrades:     openT.length,
    wins:           wins.length,
    losses:         losses.length,
    winRate:        n > 0 ? wins.length / n * 100 : 0,
    totalPnlPct,
    avgWin:         wins.length   > 0 ? parseFloat((winPnl  / wins.length).toFixed(4))   : 0,
    avgLoss:        losses.length > 0 ? parseFloat((lossPnl / losses.length).toFixed(4)) : 0,
    profitFactor:   parseFloat(Math.min(pf, 99).toFixed(2)),
    maxDrawdownPct,
    unrealizedPnlPct,
    sharpe,
    bestTradePct,
    worstTradePct,
    curve,
  };
}

// ── Bar fetching ───────────────────────────────────────────────────────────────

const TF_MAP = {
  "1m": { days: 60   },
  "3m": { days: 120  },
  "6m": { days: 210  },
  "1y": { days: 400  },
};

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }

async function fetchBars(symbol, tf, overrideDays) {
  const days = (overrideDays && overrideDays > 0) ? overrideDays : (TF_MAP[tf]?.days ?? TF_MAP["3m"].days);
  const { data } = await axios.get(`${DATA_URL}/v2/stocks/${symbol}/bars`, {
    headers: getHeaders(),
    params: {
      timeframe: "1Day",
      start: daysAgo(days),
      end: new Date().toISOString(),
      limit: 10000,
      adjustment: "raw",
      feed: "iex",
      sort: "asc",
    },
  });
  return (data.bars ?? []).map(b => ({
    time: b.t.slice(0, 10),
    open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
}

const DEFAULT_PARAMS = {
  rsi_mean_reversion: { rsi_period: 14, oversold: 30, overbought: 70 },
  ema_crossover:      { fast_period: 9, slow_period: 21, volume_multiplier: 1.2 },
  vwap_breakout:      { volume_zscore_threshold: 1.5, lookback_volume: 20 },
};

const ALL_STRATEGIES = ["rsi_mean_reversion", "ema_crossover", "vwap_breakout"];

function runStrategy(name, bars, override = {}) {
  const params = { ...DEFAULT_PARAMS[name], ...override };
  let trades;
  if      (name === "rsi_mean_reversion") trades = simRSI(bars, params);
  else if (name === "ema_crossover")      trades = simEMA(bars, params);
  else if (name === "vwap_breakout")      trades = simVWAP(bars, params);
  else return null;
  return { trades, stats: calcStats(trades), params };
}

// ── Route ──────────────────────────────────────────────────────────────────────
// GET /api/backtest
//   ?symbol=SPY                      — single symbol (default)
//   ?symbols=SPY,AAPL,TSLA           — multi-symbol comparison
//   &strategy=all                    — all | rsi_mean_reversion | ema_crossover | vwap_breakout
//   &timeframe=3m                    — 1m | 3m | 6m | 1y
//   &params={"rsi_period":20}        — JSON override for strategy params

router.get("/", async (req, res) => {
  try {
    const tf           = (req.query.timeframe || "3m").toLowerCase();
    const stratFilter  = req.query.strategy || "all";
    const strategies   = stratFilter === "all" ? ALL_STRATEGIES : [stratFilter].filter(s => DEFAULT_PARAMS[s]);
    const symbolList   = req.query.symbols
      ? req.query.symbols.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
      : [(req.query.symbol || "SPY").toUpperCase()];
    const customDays   = req.query.days ? parseInt(req.query.days, 10) : null;

    let paramsOverride = {};
    try { paramsOverride = req.query.params ? JSON.parse(req.query.params) : {}; } catch (_) {}

    // Fetch all symbols in parallel
    const barsMap = {};
    await Promise.all(symbolList.map(async sym => {
      try { barsMap[sym] = await fetchBars(sym, tf, customDays); }
      catch (e) { barsMap[sym] = []; }
    }));

    // Run strategies
    const output = {};
    for (const sym of symbolList) {
      const bars = barsMap[sym];
      output[sym] = { barCount: bars.length, results: {} };
      if (bars.length >= 30) {
        for (const strat of strategies) {
          const r = runStrategy(strat, bars, paramsOverride);
          if (r) output[sym].results[strat] = r;
        }
      }
    }

    res.json({ timeframe: tf, days: customDays ?? undefined, symbols: symbolList, data: output });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
