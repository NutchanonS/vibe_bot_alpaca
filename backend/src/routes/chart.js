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

// period → { bar size, initial window days, extended lookback days, intraday }
const TIMEFRAME_MAP = {
  "1D":  { timeframe: "5Min",  days: 1,    historyDays: 14,   intraday: true  },
  "2W":  { timeframe: "1Hour", days: 14,   historyDays: 180,  intraday: true  },
  "1W":  { timeframe: "1Hour", days: 7,    historyDays: 90,   intraday: true  },
  "1M":  { timeframe: "1Day",  days: 30,   historyDays: 365,  intraday: false },
  "3M":  { timeframe: "1Day",  days: 90,   historyDays: 730,  intraday: false },
  "1Y":  { timeframe: "1Day",  days: 365,  historyDays: 1825, intraday: false },
  "All": { timeframe: "1Week", days: 1825, historyDays: 1825, intraday: false },
};

const BAR_TIMEFRAME_MAP = {
  "5Min":  { timeframe: "5Min", intraday: true },
  "15Min": { timeframe: "15Min", intraday: true },
  "1Hour": { timeframe: "1Hour", intraday: true },
  "1Day":  { timeframe: "1Day", intraday: false },
  "1Week": { timeframe: "1Week", intraday: false },
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
  const extended = req.query.extended === "1";
  const barTf = typeof req.query.barTimeframe === "string" ? req.query.barTimeframe : "";
  const barCfg = BAR_TIMEFRAME_MAP[barTf] ?? null;
  const timeframe = barCfg?.timeframe ?? cfg.timeframe;
  const intraday = barCfg?.intraday ?? cfg.intraday;
  const lookbackDays = extended ? (cfg.historyDays ?? cfg.days) : cfg.days;

  try {
    const { data } = await axios.get(
      `${DATA_URL}/v2/stocks/${symbol}/bars`,
      {
        headers: headers(),
        params: {
          timeframe,
          start: daysAgo(lookbackDays),
          end: new Date().toISOString(),
          limit: 10000,
          adjustment: "raw",
          feed: "iex",
          sort: "asc",
        },
      }
    );

    const bars = (data.bars ?? []).map((b) => ({
      time: intraday
        ? Math.floor(new Date(b.t).getTime() / 1000)
        : b.t.slice(0, 10),
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));

    res.json({ symbol, timeframe: tf, intraday, bars, bar_timeframe: timeframe, extended });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
