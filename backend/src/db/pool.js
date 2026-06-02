/**
 * PostgreSQL connection pool singleton.
 */
const { Pool } = require("pg");

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.POSTGRES_HOST || "db",
      port: Number(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || "tradingbot",
      user: process.env.POSTGRES_USER || "trader",
      password: process.env.POSTGRES_PASSWORD || "",
    });
    _pool.on("error", (err) => console.error("[pg] Unexpected error:", err));
  }
  return _pool;
}

module.exports = { getPool };
