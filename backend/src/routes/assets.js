const router = require("express").Router();
const axios = require("axios");

const BASE = process.env.ALPACA_MODE === "production"
  ? "https://api.alpaca.markets"
  : "https://paper-api.alpaca.markets";

const headers = () => ({
  "APCA-API-KEY-ID": process.env.ALPACA_MODE === "production"
    ? process.env.ALPACA_LIVE_API_KEY : process.env.ALPACA_PAPER_API_KEY,
  "APCA-API-SECRET-KEY": process.env.ALPACA_MODE === "production"
    ? process.env.ALPACA_LIVE_SECRET_KEY : process.env.ALPACA_PAPER_SECRET_KEY,
});

// GET /api/assets?search=AAPL&limit=20
router.get("/", async (req, res) => {
  const { search = "", limit = 20 } = req.query;
  try {
    const { data } = await axios.get(`${BASE}/v2/assets`, {
      headers: headers(),
      params: { status: "active", asset_class: "us_equity" },
    });
    const q = String(search).toUpperCase();
    const filtered = data
      .filter((a) => a.tradable && a.fractionable !== false &&
        (a.symbol.startsWith(q) || a.name.toUpperCase().includes(q)))
      .slice(0, Number(limit))
      .map((a) => ({ symbol: a.symbol, name: a.name, exchange: a.exchange }));
    res.json(filtered);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
