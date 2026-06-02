const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const KEY = "indicators:config";

const INDICATOR_TYPES = {
  ema:       { label: "EMA", defaultParams: { period: 9 } },
  sma:       { label: "SMA", defaultParams: { period: 20 } },
  vwap:      { label: "VWAP", defaultParams: {}, intradayOnly: true },
  bollinger: { label: "Bollinger Bands", defaultParams: { period: 20, std: 2 } },
  rsi:       { label: "RSI", defaultParams: { period: 14 }, subPane: true },
};

const DEFAULT_COLORS = ["#f59e0b","#8b5cf6","#06b6d4","#22c55e","#ef4444","#ec4899","#14b8a6","#f97316"];

const DEFAULT_INDICATORS = {
  ema_9:  { type: "ema",  label: "EMA 9",   params: { period: 9 },  color: "#f59e0b", active: true },
  ema_21: { type: "ema",  label: "EMA 21",  params: { period: 21 }, color: "#8b5cf6", active: true },
  vwap:   { type: "vwap", label: "VWAP",    params: {},              color: "#06b6d4", active: true },
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
