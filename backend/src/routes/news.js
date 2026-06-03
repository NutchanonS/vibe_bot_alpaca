const router = require("express").Router();
const axios = require("axios");

const NEWS_URL = "https://data.alpaca.markets/v1beta1/news";

function getHeaders() {
  return {
    "APCA-API-KEY-ID":     process.env.ALPACA_MODE === "production" ? process.env.ALPACA_LIVE_API_KEY    : process.env.ALPACA_PAPER_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_MODE === "production" ? process.env.ALPACA_LIVE_SECRET_KEY : process.env.ALPACA_PAPER_SECRET_KEY,
  };
}

function relativeTime(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// GET /api/news?symbols=AAPL,SPY&limit=20&hours=24
router.get("/", async (req, res) => {
  try {
    const symbols = (req.query.symbols || "").trim();
    const limit   = Math.min(parseInt(req.query.limit)  || 20, 50);
    const hours   = Math.min(parseInt(req.query.hours)  || 24, 168); // max 1 week

    const start = new Date(Date.now() - hours * 3_600_000).toISOString();

    const { data } = await axios.get(NEWS_URL, {
      headers: getHeaders(),
      params: {
        ...(symbols ? { symbols } : {}),
        start,
        limit,
        sort: "desc",
        include_content: "false",
      },
      timeout: 8000,
    });

    const news = (data.news || []).map(a => ({
      id:         a.id,
      headline:   a.headline,
      summary:    a.summary   || "",
      source:     a.source    || "",
      author:     a.author    || "",
      url:        a.url       || "",
      symbols:    a.symbols   || [],
      created_at: a.created_at,
      ago:        relativeTime(a.created_at),
      image:      a.images?.[0]?.url || null,
    }));

    res.json({ news, count: news.length, symbols, hours });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
