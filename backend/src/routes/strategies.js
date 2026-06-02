const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const DEFAULT_STRATEGIES = {
  rsi_mean_reversion: { enabled: true, params: { rsi_period: 14, oversold: 30, overbought: 70, use_bollinger: false } },
  ema_crossover: { enabled: true, params: { fast_period: 9, slow_period: 21, volume_multiplier: 1.2 } },
  vwap_breakout: { enabled: true, params: { volume_zscore_threshold: 1.5, lookback_volume: 20 } },
};

async function getStrategies(redis) {
  const raw = await redis.get("strategies:config");
  return raw ? JSON.parse(raw) : DEFAULT_STRATEGIES;
}

// GET /api/strategies
router.get("/", async (req, res) => {
  try {
    const redis = getRedisClient();
    res.json(await getStrategies(redis));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/strategies/:name
router.patch("/:name", async (req, res) => {
  try {
    const redis = getRedisClient();
    const strategies = await getStrategies(redis);
    const name = req.params.name;
    if (!strategies[name]) {
      return res.status(404).json({ error: `Strategy '${name}' not found` });
    }
    if (req.body.enabled !== undefined) strategies[name].enabled = req.body.enabled;
    if (req.body.params) strategies[name].params = { ...strategies[name].params, ...req.body.params };
    await redis.set("strategies:config", JSON.stringify(strategies));
    res.json(strategies[name]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
