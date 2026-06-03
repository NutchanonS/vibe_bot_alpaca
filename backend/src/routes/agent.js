const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const STATUS_KEY = "agent:status";
const RUN_REQUEST_KEY = "agent:run_request";

// GET /api/agent/status
router.get("/status", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(STATUS_KEY);
    if (!raw) {
      return res.json({
        status: "idle",
        last_run_at: null,
        message: "No agent pipeline run recorded yet.",
      });
    }
    return res.json(JSON.parse(raw));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/run
router.post("/run", async (req, res) => {
  try {
    const symbols = Array.isArray(req.body?.symbols)
      ? req.body.symbols.map((s) => String(s).toUpperCase()).filter(Boolean)
      : [];

    const payload = {
      requested_at: new Date().toISOString(),
      symbols,
    };

    const redis = getRedisClient();
    await redis.set(RUN_REQUEST_KEY, JSON.stringify(payload), { EX: 300 });
    await redis.set(STATUS_KEY, JSON.stringify({
      status: "queued",
      trigger: "manual",
      requested_at: payload.requested_at,
      symbols,
      message: "Manual run queued. Waiting for strategy worker.",
    }), { EX: 3600 });

    return res.json({ queued: true, ...payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
