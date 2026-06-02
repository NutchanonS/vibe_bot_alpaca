const router = require("express").Router();
const axios = require("axios");

const ALPACA_BASE = process.env.ALPACA_MODE === "production"
  ? "https://api.alpaca.markets"
  : "https://paper-api.alpaca.markets";

const API_KEY = process.env.ALPACA_MODE === "production"
  ? process.env.ALPACA_LIVE_API_KEY
  : process.env.ALPACA_PAPER_API_KEY;

const SECRET_KEY = process.env.ALPACA_MODE === "production"
  ? process.env.ALPACA_LIVE_SECRET_KEY
  : process.env.ALPACA_PAPER_SECRET_KEY;

const headers = () => ({
  "APCA-API-KEY-ID": API_KEY,
  "APCA-API-SECRET-KEY": SECRET_KEY,
});

// GET /api/orders?status=open|closed
router.get("/", async (req, res) => {
  try {
    const status = req.query.status || "open";
    const { data } = await axios.get(`${ALPACA_BASE}/v2/orders`, {
      headers: headers(),
      params: { status, limit: 100 },
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// POST /api/orders — place a manual order
router.post("/", async (req, res) => {
  try {
    const { symbol, qty, side, type, limit_price, stop_price } = req.body;
    const payload = { symbol, qty, side, type, time_in_force: "day" };
    if (limit_price) payload.limit_price = String(limit_price);
    if (stop_price) payload.stop_price = String(stop_price);

    const { data } = await axios.post(`${ALPACA_BASE}/v2/orders`, payload, {
      headers: headers(),
    });
    res.status(201).json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// DELETE /api/orders/:id
router.delete("/:id", async (req, res) => {
  try {
    await axios.delete(`${ALPACA_BASE}/v2/orders/${req.params.id}`, {
      headers: headers(),
    });
    res.status(204).end();
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
