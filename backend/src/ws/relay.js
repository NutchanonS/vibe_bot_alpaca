/**
 * WebSocket relay — subscribes to Redis pub/sub channels and
 * forwards events to connected browser clients via Socket.io.
 */
const { createClient } = require("redis");

const REDIS_HOST = process.env.REDIS_HOST || "redis";
const REDIS_PORT = process.env.REDIS_PORT || 6379;

function startRelay(io) {
  const subscriber = createClient({ socket: { host: REDIS_HOST, port: Number(REDIS_PORT) } });

  subscriber.connect().then(() => {
    console.log("[ws/relay] Redis subscriber connected");

    subscriber.subscribe("quote", (message) => {
      io.emit("quote", JSON.parse(message));
    });

    subscriber.subscribe("order_update", (message) => {
      io.emit("order_update", JSON.parse(message));
    });

    subscriber.subscribe("signal_fired", (message) => {
      io.emit("signal_fired", JSON.parse(message));
    });

    subscriber.subscribe("position_change", (message) => {
      io.emit("position_change", JSON.parse(message));
    });
  }).catch((err) => {
    console.error("[ws/relay] Redis connection failed:", err.message);
  });

  io.on("connection", (socket) => {
    console.log("[ws/relay] Client connected:", socket.id);
    socket.on("disconnect", () => {
      console.log("[ws/relay] Client disconnected:", socket.id);
    });
  });
}

module.exports = { startRelay };
