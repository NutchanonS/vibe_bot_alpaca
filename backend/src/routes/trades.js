const router = require("express").Router();
const { getPool } = require("../db/pool");

// GET /api/trades — returns trade history from PostgreSQL
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT * FROM trades ORDER BY filled_at DESC LIMIT 200"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
