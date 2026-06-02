const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const STRATEGY_TYPES = {
  rsi_mean_reversion: {
    label: "RSI Mean Reversion",
    defaultParams: { rsi_period: 14, oversold: 30, overbought: 70, use_bollinger: false },
  },
  ema_crossover: {
    label: "EMA Crossover",
    defaultParams: { fast_period: 9, slow_period: 21, volume_multiplier: 1.2 },
  },
  vwap_breakout: {
    label: "VWAP Breakout",
    defaultParams: { volume_zscore_threshold: 1.5, lookback_volume: 20 },
  },
};

const DEFAULT_STRATEGIES = {
  rsi_mean_reversion: { type: "rsi_mean_reversion", enabled: true, params: STRATEGY_TYPES.rsi_mean_reversion.defaultParams },
  ema_crossover:      { type: "ema_crossover",      enabled: true, params: STRATEGY_TYPES.ema_crossover.defaultParams },
  vwap_breakout:      { type: "vwap_breakout",      enabled: true, params: STRATEGY_TYPES.vwap_breakout.defaultParams },
};

async function getStrategies(redis) {
  const raw = await redis.get("strategies:config");
  if (!raw) return DEFAULT_STRATEGIES;
  const parsed = JSON.parse(raw);
  // Backfill `type` field for older entries that don't have it
  Object.entries(parsed).forEach(([name, cfg]) => {
    if (!cfg.type) cfg.type = name.replace(/_\d+$/, "");
  });
  return parsed;
}

// GET /api/strategies
router.get("/", async (req, res) => {
  try {
    res.json(await getStrategies(getRedisClient()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/strategies/types — list available strategy types for the Add modal
router.get("/types", async (_req, res) => {
  res.json(STRATEGY_TYPES);
});

// POST /api/strategies — add a new strategy instance
router.post("/", async (req, res) => {
  try {
    const { name, type, params } = req.body;
    if (!name || !type) return res.status(400).json({ error: "name and type are required" });
    if (!STRATEGY_TYPES[type]) return res.status(400).json({ error: `Unknown type '${type}'` });

    const slug = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!slug) return res.status(400).json({ error: "Invalid name" });

    const redis = getRedisClient();
    const strategies = await getStrategies(redis);

    if (strategies[slug]) return res.status(409).json({ error: `Strategy '${slug}' already exists` });

    strategies[slug] = {
      type,
      label: name,
      enabled: true,
      params: { ...STRATEGY_TYPES[type].defaultParams, ...(params ?? {}) },
    };

    await redis.set("strategies:config", JSON.stringify(strategies));
    res.status(201).json({ [slug]: strategies[slug] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/strategies/:name
router.patch("/:name", async (req, res) => {
  try {
    const redis = getRedisClient();
    const strategies = await getStrategies(redis);
    const { name } = req.params;
    if (!strategies[name]) return res.status(404).json({ error: `Strategy '${name}' not found` });

    if (req.body.enabled !== undefined) strategies[name].enabled = req.body.enabled;
    if (req.body.params) strategies[name].params = { ...strategies[name].params, ...req.body.params };

    await redis.set("strategies:config", JSON.stringify(strategies));
    res.json(strategies[name]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/strategies/:name — only custom strategies can be deleted
router.delete("/:name", async (req, res) => {
  try {
    const { name } = req.params;
    if (DEFAULT_STRATEGIES[name]) return res.status(403).json({ error: "Cannot delete built-in strategies" });

    const redis = getRedisClient();
    const strategies = await getStrategies(redis);
    if (!strategies[name]) return res.status(404).json({ error: "Not found" });

    delete strategies[name];
    await redis.set("strategies:config", JSON.stringify(strategies));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
