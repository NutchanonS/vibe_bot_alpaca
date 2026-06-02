const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const KEY = "indicators:config";

// 30 indicator types grouped by category
const INDICATOR_TYPES = {
  // ── Moving Averages ──────────────────────────────────────────────────────────
  ema:       { label: "EMA",             desc: "Exponential Moving Average — weighted toward recent prices",                  defaultParams: { period: 9 } },
  sma:       { label: "SMA",             desc: "Simple Moving Average — equal weight to all prices in window",                defaultParams: { period: 20 } },
  wma:       { label: "WMA",             desc: "Weighted MA — linear weights, more responsive than SMA",                     defaultParams: { period: 14 } },
  dema:      { label: "DEMA",            desc: "Double EMA — 2×EMA(n) - EMA(EMA(n)), less lag than EMA",                    defaultParams: { period: 21 } },
  tema:      { label: "TEMA",            desc: "Triple EMA — 3×EMA1 - 3×EMA2 + EMA3, minimal lag",                          defaultParams: { period: 21 } },
  hma:       { label: "HMA",             desc: "Hull MA — WMA-based, almost no lag while remaining smooth",                  defaultParams: { period: 14 } },
  vwma:      { label: "VWMA",            desc: "Volume Weighted MA — prices weighted by their volume",                       defaultParams: { period: 20 } },
  // ── Price / Volume ───────────────────────────────────────────────────────────
  vwap:      { label: "VWAP",            desc: "Volume Weighted Average Price — intraday benchmark",                          defaultParams: {}, intradayOnly: true },
  vwap_bands:{ label: "VWAP Bands",      desc: "VWAP ± standard deviation bands",                                            defaultParams: { std: 2 }, intradayOnly: true },
  // ── Trend Signals ───────────────────────────────────────────────────────────
  supertrend:{ label: "Supertrend",      desc: "ATR-based trend signal — green below price = up, red above = down",          defaultParams: { period: 10, multiplier: 3 } },
  psar:      { label: "Parabolic SAR",   desc: "Stop-and-reverse dots — follow trend until price crosses dots",               defaultParams: { step: 0.02, max: 0.2 } },
  ichimoku:  { label: "Ichimoku",        desc: "Cloud-based multi-component trend and support/resistance system",             defaultParams: { tenkan: 9, kijun: 26, senkou: 52 } },
  // ── Volatility / Channels ───────────────────────────────────────────────────
  bollinger: { label: "Bollinger Bands", desc: "EMA ± N standard deviations — squeeze signals low volatility",               defaultParams: { period: 20, std: 2 } },
  keltner:   { label: "Keltner Channel", desc: "EMA ± ATR×mult — wider than Bollinger in low volatility",                   defaultParams: { period: 20, multiplier: 2 } },
  donchian:  { label: "Donchian Channel",desc: "Highest high / Lowest low channel over N periods",                           defaultParams: { period: 20 } },
  // ── Oscillators (sub-pane) ───────────────────────────────────────────────────
  rsi:       { label: "RSI",             desc: "Relative Strength Index 0–100 · Oversold <30, Overbought >70",               defaultParams: { period: 14 }, subPane: true },
  macd:      { label: "MACD",            desc: "MACD line + signal line + histogram · trend momentum",                       defaultParams: { fast: 12, slow: 26, signal: 9 }, subPane: true },
  stoch:     { label: "Stochastic",      desc: "Stochastic %K/%D 0–100 · Oversold <20, Overbought >80",                     defaultParams: { period: 14, smooth: 3 }, subPane: true },
  cci:       { label: "CCI",             desc: "Commodity Channel Index · extremes at ±100 signal reversals",                defaultParams: { period: 20 }, subPane: true },
  williams:  { label: "Williams %R",     desc: "Williams %R -100–0 · Oversold <-80, Overbought >-20",                       defaultParams: { period: 14 }, subPane: true },
  roc:       { label: "ROC",             desc: "Rate of Change % · positive = momentum up, negative = down",                 defaultParams: { period: 12 }, subPane: true },
  momentum:  { label: "Momentum",        desc: "Price − price[n periods ago] · zero-line crossings signal trend change",     defaultParams: { period: 10 }, subPane: true },
  zscore:    { label: "Z-Score",         desc: "Std deviations from rolling mean · ±2 signals overbought/oversold",          defaultParams: { period: 20 }, subPane: true },
  aroon:     { label: "Aroon",           desc: "Aroon Up/Down 0–100 · crossover signals new trend",                         defaultParams: { period: 25 }, subPane: true },
  // ── Volume Oscillators (sub-pane) ────────────────────────────────────────────
  obv:       { label: "OBV",             desc: "On-Balance Volume — cumulative buy/sell pressure",                            defaultParams: {}, subPane: true },
  mfi:       { label: "MFI",             desc: "Money Flow Index 0–100 · volume-weighted RSI",                               defaultParams: { period: 14 }, subPane: true },
  cmf:       { label: "CMF",             desc: "Chaikin Money Flow -1 to +1 · positive = accumulation",                     defaultParams: { period: 20 }, subPane: true },
  // ── Volatility Measures (sub-pane) ───────────────────────────────────────────
  atr:       { label: "ATR",             desc: "Average True Range — absolute volatility, used for stop sizing",              defaultParams: { period: 14 }, subPane: true },
  adx:       { label: "ADX",             desc: "Average Directional Index 0–100 · >25 = strong trend",                      defaultParams: { period: 14 }, subPane: true },
  stddev:    { label: "Std Dev",         desc: "Rolling standard deviation of closes — rising = increasing volatility",       defaultParams: { period: 20 }, subPane: true },
};

const DEFAULT_COLORS = ["#f59e0b","#8b5cf6","#06b6d4","#22c55e","#ef4444","#ec4899","#14b8a6","#f97316"];

const DEFAULT_INDICATORS = {
  ema_9:  { type: "ema",  label: "EMA 9",  params: { period: 9 },  color: "#f59e0b", active: true },
  ema_21: { type: "ema",  label: "EMA 21", params: { period: 21 }, color: "#8b5cf6", active: true },
  vwap:   { type: "vwap", label: "VWAP",   params: {},              color: "#06b6d4", active: true },
};

async function getIndicators(redis) {
  const raw = await redis.get(KEY);
  return raw ? JSON.parse(raw) : DEFAULT_INDICATORS;
}

router.get("/types", (_req, res) => res.json(INDICATOR_TYPES));

router.get("/", async (_req, res) => {
  try { res.json(await getIndicators(getRedisClient())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/", async (req, res) => {
  try {
    const { type, label, params, color } = req.body;
    if (!type || !INDICATOR_TYPES[type]) return res.status(400).json({ error: "Invalid type" });
    const redis = getRedisClient();
    const inds = await getIndicators(redis);
    const count = Object.values(inds).filter(i => i.type === type).length;
    const id = `${type}_${Date.now()}`;
    inds[id] = {
      type,
      label: label || `${INDICATOR_TYPES[type].label} ${count + 1}`,
      params: { ...INDICATOR_TYPES[type].defaultParams, ...(params ?? {}) },
      color: color || DEFAULT_COLORS[Object.keys(inds).length % DEFAULT_COLORS.length],
      active: true,
    };
    await redis.set(KEY, JSON.stringify(inds));
    res.status(201).json({ id, ...inds[id] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/:id", async (req, res) => {
  try {
    const redis = getRedisClient();
    const inds = await getIndicators(redis);
    if (!inds[req.params.id]) return res.status(404).json({ error: "Not found" });
    Object.assign(inds[req.params.id], req.body);
    await redis.set(KEY, JSON.stringify(inds));
    res.json(inds[req.params.id]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/:id", async (req, res) => {
  try {
    const redis = getRedisClient();
    const inds = await getIndicators(redis);
    delete inds[req.params.id];
    await redis.set(KEY, JSON.stringify(inds));
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
