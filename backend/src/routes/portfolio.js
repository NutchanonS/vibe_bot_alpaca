const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

// GET /api/portfolio — returns cached portfolio snapshot from Redis
router.get("/", async (req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("portfolio:snapshot");
    if (!raw) {
      return res.json({ equity: "0", cash: "0", buying_power: "0", positions: [] });
    }
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
