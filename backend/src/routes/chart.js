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

// period → { bar size, lookback days, intraday }
const TIMEFRAME_MAP = {
  "1D": { timeframe: "5Min",  days: 1,   intraday: true  },
  "1W": { timeframe: "1Hour", days: 7,   intraday: true  },
  "1M": { timeframe: "1Day",  days: 30,  intraday: false },
  "3M": { timeframe: "1Day",  days: 90,  intraday: false },
  "1Y": { timeframe: "1Day",  days: 365, intraday: false },
};

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// GET /api/chart/:symbol?timeframe=1D
router.get("/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const tf = req.query.timeframe || "1M";
  const cfg = TIMEFRAME_MAP[tf] ?? TIMEFRAME_MAP["1M"];

  try {
    const { data } = await axios.get(
      `${DATA_URL}/v2/stocks/${symbol}/bars`,
      {
        headers: headers(),
        params: {
          timeframe: cfg.timeframe,
          start: daysAgo(cfg.days),
          end: new Date().toISOString(),
          limit: 1000,
          adjustment: "raw",
          feed: "iex",
          sort: "asc",
        },
      }
    );

    const bars = (data.bars ?? []).map((b) => ({
      time: cfg.intraday
        ? Math.floor(new Date(b.t).getTime() / 1000)
        : b.t.slice(0, 10),
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));

    res.json({ symbol, timeframe: tf, intraday: cfg.intraday, bars });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
