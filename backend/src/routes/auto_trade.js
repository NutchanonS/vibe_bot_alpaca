/**
 * Auto-trade settings + pending approvals
 *
 * GET  /api/auto-trade/settings              — both scanner settings
 * PATCH /api/auto-trade/settings/waterfall   — update waterfall settings
 * PATCH /api/auto-trade/settings/momentum    — update momentum settings
 * GET  /api/auto-trade/daily-counts          — today's executed trade counts
 *
 * GET  /api/scanner/pending-orders           — waterfall pending approvals
 * POST /api/scanner/pending-orders/:id/approve
 * POST /api/scanner/pending-orders/:id/reject
 *
 * GET  /api/momentum/pending-orders          — momentum pending approvals
 * POST /api/momentum/pending-orders/:id/approve
 * POST /api/momentum/pending-orders/:id/reject
 */

const router = require("express").Router();
const { getRedisClient } = require("../../redis/cache");

const DEFAULTS = { enabled: false, mode: "approve", min_confidence: 0.70, max_daily_trades: 3 };
const VALID_MODES = ["auto", "approve"];

function pendingKey(scanner) {
  return scanner === "waterfall" ? "scanner:pending_orders" : "momentum:pending_orders";
}

function todayKey(scanner) {
  const d = new Date().toISOString().slice(0, 10);
  return `${scanner}:daily_trades:${d}`;
}

async function getSettings(redis, scanner) {
  const raw = await redis.get(`settings:${scanner}_auto_trade`);
  return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
}

async function getPending(redis, scanner) {
  const raw = await redis.get(pendingKey(scanner));
  return raw ? JSON.parse(raw) : {};
}

// ── Settings ──────────────────────────────────────────────────────────────────

router.get("/settings", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const [wf, mom] = await Promise.all([
      getSettings(redis, "waterfall"),
      getSettings(redis, "momentum"),
    ]);
    return res.json({ waterfall: wf, momentum: mom });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function makePatchHandler(scanner) {
  return async (req, res) => {
    try {
      const redis = getRedisClient();
      const current = await getSettings(redis, scanner);
      const patch = {};

      if (typeof req.body.enabled === "boolean") patch.enabled = req.body.enabled;
      if (VALID_MODES.includes(req.body.mode))    patch.mode    = req.body.mode;

      const minConf = parseFloat(req.body.min_confidence);
      if (!isNaN(minConf)) patch.min_confidence = Math.max(0.50, Math.min(1.0, minConf));

      const maxTrades = parseInt(req.body.max_daily_trades, 10);
      if (!isNaN(maxTrades)) patch.max_daily_trades = Math.max(1, Math.min(10, maxTrades));

      const updated = { ...current, ...patch };
      await redis.set(`settings:${scanner}_auto_trade`, JSON.stringify(updated), { EX: 2_592_000 }); // 30 days
      return res.json({ ok: true, scanner, settings: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

router.patch("/settings/waterfall", makePatchHandler("waterfall"));
router.patch("/settings/momentum",  makePatchHandler("momentum"));

router.get("/daily-counts", async (_req, res) => {
  try {
    const redis = getRedisClient();
    const [wf, mom] = await Promise.all([
      redis.get(todayKey("waterfall")),
      redis.get(todayKey("momentum")),
    ]);
    return res.json({
      waterfall: parseInt(wf || "0", 10),
      momentum:  parseInt(mom || "0", 10),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Pending orders ────────────────────────────────────────────────────────────

function makePendingRoutes(scanner) {
  const pendingRouter = require("express").Router();

  pendingRouter.get("/pending-orders", async (_req, res) => {
    try {
      const redis   = getRedisClient();
      const orders  = await getPending(redis, scanner);
      const now     = new Date().toISOString();
      // Return list sorted newest first, exclude already-executed/expired
      const list = Object.values(orders)
        .filter(o => o.status === "pending" || o.status === "approved")
        .sort((a, b) => b.created_at?.localeCompare(a.created_at));
      return res.json({ scanner, orders: list, total: list.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  pendingRouter.post("/pending-orders/:id/approve", async (req, res) => {
    try {
      const redis  = getRedisClient();
      const orders = await getPending(redis, scanner);
      const order  = orders[req.params.id];
      if (!order)  return res.status(404).json({ error: "Order not found" });
      if (order.status !== "pending") return res.status(400).json({ error: `Order status is '${order.status}', not pending` });

      order.status      = "approved";
      order.approved_at = new Date().toISOString();
      await redis.set(pendingKey(scanner), JSON.stringify(orders), { EX: 86_400 });
      return res.json({ ok: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  pendingRouter.post("/pending-orders/:id/reject", async (req, res) => {
    try {
      const redis  = getRedisClient();
      const orders = await getPending(redis, scanner);
      const order  = orders[req.params.id];
      if (!order)  return res.status(404).json({ error: "Order not found" });
      if (order.status !== "pending") return res.status(400).json({ error: `Order status is '${order.status}', not pending` });

      order.status      = "rejected";
      order.rejected_at = new Date().toISOString();
      await redis.set(pendingKey(scanner), JSON.stringify(orders), { EX: 86_400 });
      return res.json({ ok: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return pendingRouter;
}

const waterfallPendingRouter = makePendingRoutes("waterfall");
const momentumPendingRouter  = makePendingRoutes("momentum");

module.exports = { autoTradeRouter: router, waterfallPendingRouter, momentumPendingRouter };
