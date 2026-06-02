const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const WATCHLIST_KEY = "watchlist:symbols";
const DEFAULT_SYMBOLS = ["SPY", "AAPL", "TSLA", "NVDA", "QQQ"];

// GET /api/watchlist
router.get("/", async (req, res) => {
  try {
    const redis = getRedisClient();
    const members = await redis.sMembers(WATCHLIST_KEY);
    res.json(members.length ? members : DEFAULT_SYMBOLS);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/watchlist — add symbol
router.post("/", async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    const redis = getRedisClient();
    await redis.sAdd(WATCHLIST_KEY, symbol.toUpperCase());
    const members = await redis.sMembers(WATCHLIST_KEY);
    res.status(201).json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/watchlist/:symbol
router.delete("/:symbol", async (req, res) => {
  try {
    const redis = getRedisClient();
    await redis.sRem(WATCHLIST_KEY, req.params.symbol.toUpperCase());
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
