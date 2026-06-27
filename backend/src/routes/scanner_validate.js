/**
 * Scanner Validation routes
 *
 * Waterfall:
 *   POST /api/scanner/validate   — queue a historical waterfall replay
 *   GET  /api/scanner/validate/status
 *   GET  /api/scanner/validate/results
 *
 * Momentum:
 *   POST /api/momentum/validate  — queue a historical momentum replay
 *   GET  /api/momentum/validate/status
 *   GET  /api/momentum/validate/results
 */

const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const VALID_UNIVERSES = ["default", "tech", "etfs"];

function parseDate(val) {
  if (!val) return null;
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? val : null;
}

// ── Waterfall validate ────────────────────────────────────────────────────────

router.post("/validate", async (req, res) => {
  try {
    const date = parseDate(req.body?.date);
    if (!date) return res.status(400).json({ error: "Invalid or missing date (YYYY-MM-DD)" });

    const stage1_top_n   = Math.max(5,  Math.min(parseInt(req.body?.stage1_top_n ?? "20", 10) || 20, 9999));
    const stage2_top_n   = Math.max(3,  Math.min(parseInt(req.body?.stage2_top_n ?? "10", 10) || 10, 9999));
    const universe       = VALID_UNIVERSES.includes(req.body?.universe) ? req.body.universe : "default";
    const forward_days   = Math.max(1,  Math.min(parseInt(req.body?.forward_days  ?? "3",  10) || 3,  10));
    const include_stage3 = req.body?.include_stage3 !== false;
    const include_stage4 = req.body?.include_stage4 === true;
    const include_stage5 = req.body?.include_stage5 === true;

    const payload = {
      date,
      universe: universe === "default" ? null : universe,
      stage1_top_n,
      stage2_top_n,
      forward_days,
      include_stage3,
      include_stage4,
      include_stage5,
      requested_at: new Date().toISOString(),
    };

    const redis = getRedisClient();
    await redis.set("scanner:validate_request", JSON.stringify(payload), { EX: 600 });
    await redis.set("scanner:validate_status", JSON.stringify({
      status:       "queued",
      date,
      requested_at: payload.requested_at,
      message:      "Validation queued. Worker polls every 15 s.",
    }), { EX: 3600 });

    return res.json({ queued: true, ...payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/validate/status", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("scanner:validate_status");
    return res.json(raw ? JSON.parse(raw) : { status: "idle" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/validate/results", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("scanner:validate_results");
    return res.json(raw ? JSON.parse(raw) : { status: "idle", ranked: [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Waterfall sweep (multi-date) ─────────────────────────────────────────────

router.post("/sweep", async (req, res) => {
  try {
    const start_date = parseDate(req.body?.start_date);
    const end_date   = parseDate(req.body?.end_date);
    if (!start_date || !end_date) return res.status(400).json({ error: "Invalid or missing start_date / end_date (YYYY-MM-DD)" });
    if (start_date > end_date)    return res.status(400).json({ error: "start_date must be before end_date" });

    const stage1_top_n   = Math.max(5,  Math.min(parseInt(req.body?.stage1_top_n  ?? "20", 10) || 20, 9999));
    const stage2_top_n   = Math.max(3,  Math.min(parseInt(req.body?.stage2_top_n  ?? "10", 10) || 10, 9999));
    const forward_days   = Math.max(1,  Math.min(parseInt(req.body?.forward_days  ?? "3",  10) || 3,  10));
    const sample_every   = Math.max(1,  Math.min(parseInt(req.body?.sample_every  ?? "1",  10) || 1,  5));
    const universe       = VALID_UNIVERSES.includes(req.body?.universe) ? req.body.universe : "default";
    const include_stage3 = req.body?.include_stage3 !== false;
    const include_stage4 = req.body?.include_stage4 === true;
    const include_stage5 = req.body?.include_stage5 === true;

    const payload = {
      start_date, end_date, forward_days, sample_every,
      universe: universe === "default" ? null : universe,
      stage1_top_n, stage2_top_n, include_stage3, include_stage4, include_stage5,
      requested_at: new Date().toISOString(),
    };

    const redis = getRedisClient();
    await redis.set("scanner:sweep_request", JSON.stringify(payload), { EX: 900 });
    await redis.set("scanner:sweep_status", JSON.stringify({
      status: "queued", start_date, end_date, requested_at: payload.requested_at,
      message: "Sweep queued. Worker polls every 15 s.",
    }), { EX: 7200 });

    return res.json({ queued: true, ...payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/sweep/status", async (_req, res) => {
  try {
    const raw = await getRedisClient().get("scanner:sweep_status");
    return res.json(raw ? JSON.parse(raw) : { status: "idle" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/sweep/results", async (_req, res) => {
  try {
    const raw = await getRedisClient().get("scanner:sweep_results");
    return res.json(raw ? JSON.parse(raw) : { status: "idle", by_date: [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Momentum validate (separate prefix — mounted at /api/momentum) ─────────

const momentumValidateRouter = require("express").Router();

momentumValidateRouter.post("/validate", async (req, res) => {
  try {
    const date = parseDate(req.body?.date);
    if (!date) return res.status(400).json({ error: "Invalid or missing date (YYYY-MM-DD)" });

    const stage1_top_n   = Math.max(5, Math.min(parseInt(req.body?.stage1_top_n ?? "20", 10) || 20, 200));
    const stage2_top_n   = Math.max(3, Math.min(parseInt(req.body?.stage2_top_n ?? "10", 10) || 10, 50));
    const include_stage3 = req.body?.include_stage3 !== false;
    const include_stage4 = req.body?.include_stage4 === true;
    const include_stage5 = req.body?.include_stage5 === true;

    const payload = {
      date,
      stage1_top_n,
      stage2_top_n,
      include_stage3,
      include_stage4,
      include_stage5,
      requested_at: new Date().toISOString(),
    };

    const redis = getRedisClient();
    await redis.set("momentum:validate_request", JSON.stringify(payload), { EX: 600 });
    await redis.set("momentum:validate_status", JSON.stringify({
      status:       "queued",
      date,
      requested_at: payload.requested_at,
      message:      "Momentum validation queued. Worker polls every 15 s.",
    }), { EX: 3600 });

    return res.json({ queued: true, ...payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

momentumValidateRouter.get("/validate/status", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("momentum:validate_status");
    return res.json(raw ? JSON.parse(raw) : { status: "idle" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

momentumValidateRouter.get("/validate/results", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const raw = await redis.get("momentum:validate_results");
    return res.json(raw ? JSON.parse(raw) : { status: "idle", ranked: [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Momentum sweep (multi-date) ───────────────────────────────────────────────

momentumValidateRouter.post("/sweep", async (req, res) => {
  try {
    const start_date = parseDate(req.body?.start_date);
    const end_date   = parseDate(req.body?.end_date);
    if (!start_date || !end_date) return res.status(400).json({ error: "Invalid or missing start_date / end_date (YYYY-MM-DD)" });
    if (start_date > end_date)    return res.status(400).json({ error: "start_date must be before end_date" });

    const stage1_top_n   = Math.max(5, Math.min(parseInt(req.body?.stage1_top_n ?? "20", 10) || 20, 200));
    const stage2_top_n   = Math.max(3, Math.min(parseInt(req.body?.stage2_top_n ?? "10", 10) || 10, 50));
    const sample_every   = Math.max(1, Math.min(parseInt(req.body?.sample_every ?? "1",  10) || 1,  5));
    const include_stage3 = req.body?.include_stage3 !== false;
    const include_stage4 = req.body?.include_stage4 === true;
    const include_stage5 = req.body?.include_stage5 === true;

    const payload = {
      start_date, end_date, sample_every,
      stage1_top_n, stage2_top_n, include_stage3, include_stage4, include_stage5,
      requested_at: new Date().toISOString(),
    };

    const redis = getRedisClient();
    await redis.set("momentum:sweep_request", JSON.stringify(payload), { EX: 900 });
    await redis.set("momentum:sweep_status", JSON.stringify({
      status: "queued", start_date, end_date, requested_at: payload.requested_at,
      message: "Momentum sweep queued. Worker polls every 15 s.",
    }), { EX: 7200 });

    return res.json({ queued: true, ...payload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

momentumValidateRouter.get("/sweep/status", async (_req, res) => {
  try {
    const raw = await getRedisClient().get("momentum:sweep_status");
    return res.json(raw ? JSON.parse(raw) : { status: "idle" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

momentumValidateRouter.get("/sweep/results", async (_req, res) => {
  try {
    const raw = await getRedisClient().get("momentum:sweep_results");
    return res.json(raw ? JSON.parse(raw) : { status: "idle", by_date: [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { waterfallValidateRouter: router, momentumValidateRouter };
