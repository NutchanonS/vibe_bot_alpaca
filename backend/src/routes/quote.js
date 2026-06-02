const router = require("express").Router();
const axios = require("axios");

const DATA_URL = "https://data.alpaca.markets";

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

// GET /api/quote/:symbol — latest trade + snapshot
router.get("/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const [tradeRes, snapRes] = await Promise.all([
      axios.get(`${DATA_URL}/v2/stocks/${symbol}/trades/latest`, { headers: headers(), params: { feed: "iex" } }),
      axios.get(`${DATA_URL}/v2/stocks/${symbol}/snapshot`, { headers: headers(), params: { feed: "iex" } }),
    ]);

    const trade = tradeRes.data.trade;
    const snap = snapRes.data;

    res.json({
      symbol,
      price: trade?.p ?? null,
      change: snap?.dailyBar ? snap.dailyBar.c - snap.prevDailyBar?.c : null,
      change_pct: snap?.dailyBar && snap.prevDailyBar
        ? ((snap.dailyBar.c - snap.prevDailyBar.c) / snap.prevDailyBar.c) * 100
        : null,
      open: snap?.dailyBar?.o ?? null,
      high: snap?.dailyBar?.h ?? null,
      low: snap?.dailyBar?.l ?? null,
      volume: snap?.dailyBar?.v ?? null,
      prev_close: snap?.prevDailyBar?.c ?? null,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
