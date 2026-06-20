const express = require("express");
const router = express.Router();
const { getRedisClient } = require("../../redis/cache");

// POST /api/news-backtest/run
// Body: { symbol, start_date, end_date, sample_every }
router.post("/run", async (req, res) => {
  try {
    const { symbol, start_date, end_date, sample_every = 2 } = req.body;

    if (!symbol || !start_date || !end_date) {
      return res.status(400).json({ error: "symbol, start_date, and end_date are required." });
    }

    const sym      = String(symbol).toUpperCase().trim();
    const startStr = String(start_date).slice(0, 10);
    const endStr   = String(end_date).slice(0, 10);
    const every    = Math.max(1, Math.min(parseInt(sample_every) || 2, 7));

    const redis = getRedisClient();
    await redis.set(
      "news_backtest:run_request",
      JSON.stringify({ symbol: sym, start_date: startStr, end_date: endStr, sample_every: every }),
      { EX: 300 }
    );
    await redis.set(
      "news_backtest:status",
      JSON.stringify({ status: "queued", symbol: sym, start_date: startStr, end_date: endStr, queued_at: new Date().toISOString() }),
      { EX: 300 }
    );

    res.json({ ok: true, symbol: sym, start_date: startStr, end_date: endStr, sample_every: every });
  } catch (err) {
    console.error("news-backtest /run error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// GET /api/news-backtest/status
router.get("/status", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("news_backtest:status");
    res.json(raw ? JSON.parse(raw) : { status: "idle" });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// GET /api/news-backtest/results
router.get("/results", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("news_backtest:results");
    if (!raw) return res.json({ status: "no_results" });
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
