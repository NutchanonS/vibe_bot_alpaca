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

app.set("etag", false);

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

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

// Chart, quote, assets, indicators, backtest
app.use("/api/chart", authMiddleware, require("./routes/chart"));
app.use("/api/quote", authMiddleware, require("./routes/quote"));
app.use("/api/assets", authMiddleware, require("./routes/assets"));
app.use("/api/indicators", authMiddleware, require("./routes/indicators"));
app.use("/api/backtest", authMiddleware, require("./routes/backtest"));
app.use("/api/news",    authMiddleware, require("./routes/news"));
app.use("/api/agent",   authMiddleware, require("./routes/agent"));

// Start WebSocket relay
startRelay(io);

const PORT = process.env.BACKEND_PORT || 8000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

module.exports = { app, io };
