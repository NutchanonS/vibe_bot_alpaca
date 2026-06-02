require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");

const portfolioRoutes = require("./routes/portfolio");
const tradesRoutes = require("./routes/trades");
const ordersRoutes = require("./routes/orders");
const strategiesRoutes = require("./routes/strategies");
const watchlistRoutes = require("./routes/watchlist");
const authRoutes = require("./routes/auth");
const { authMiddleware } = require("./middleware/auth");
const { startRelay } = require("./ws/relay");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/ws/socket.io",
});

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Health check — no auth required
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Auth
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/portfolio", authMiddleware, portfolioRoutes);
app.use("/api/trades", authMiddleware, tradesRoutes);
app.use("/api/orders", authMiddleware, ordersRoutes);
app.use("/api/strategies", authMiddleware, strategiesRoutes);
app.use("/api/watchlist", authMiddleware, watchlistRoutes);

// Chart endpoint
app.get("/api/chart/:symbol", authMiddleware, async (req, res) => {
  // TODO: proxy bars from Alpaca data API
  res.json({ symbol: req.params.symbol, bars: [] });
});

// Start WebSocket relay
startRelay(io);

const PORT = process.env.BACKEND_PORT || 8000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

module.exports = { app, io };
