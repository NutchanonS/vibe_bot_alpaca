const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const RUN_REQUEST_KEY = "scanner:run_request";
const STATUS_KEY      = "scanner:status";
const RESULTS_KEY     = "scanner:results";

const VALID_UNIVERSES = ["default", "tech", "etfs"];

// POST /api/scanner/run
router.post("/run", async (req, res) => {
  try {
    const stage1_top_n = Math.max(5, Math.min(parseInt(req.body?.stage1_top_n ?? "20", 10) || 20, 9999));
    const stage2_top_n = Math.max(3, Math.min(parseInt(req.body?.stage2_top_n ?? "10", 10) || 10, 9999));
    const universe     = VALID_UNIVERSES.includes(req.body?.universe) ? req.body.universe : "default";

    const payload = {
      requested_at: new Date().toISOString(),
      stage1_top_n,
      stage2_top_n,
      universe: universe === "default" ? null : universe,
    };

    const redis = getRedisClient();
    await redis.set(RUN_REQUEST_KEY, JSON.stringify(payload), { EX: 300 });
    await redis.set(STATUS_KEY, JSON.stringify({
      status:       "queued",
      requested_at: payload.requested_at,
      stage1_top_n,
      stage2_top_n,
      universe,
      message:      "Scan queued. Waiting for strategy worker (polls every 15s).",
    }), { EX: 3600 });

    return res.json({ queued: true, ...payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/scanner/status
router.get("/status", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(STATUS_KEY);
    if (!raw) return res.json({ status: "idle" });
    return res.json(JSON.parse(raw));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/scanner/results
router.get("/results", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(RESULTS_KEY);
    if (!raw) return res.json({ status: "idle", ranked: [] });
    return res.json(JSON.parse(raw));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
