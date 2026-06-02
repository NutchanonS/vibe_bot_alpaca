/**
 * Redis client singleton for the backend.
 */
const { createClient } = require("redis");

let _client = null;

function getRedisClient() {
  if (!_client) {
    _client = createClient({
      socket: {
        host: process.env.REDIS_HOST || "redis",
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    });
    _client.on("error", (err) => console.error("[redis] Error:", err));
    _client.connect().then(() => console.log("[redis] Connected"));
  }
  return _client;
}

module.exports = { getRedisClient };
