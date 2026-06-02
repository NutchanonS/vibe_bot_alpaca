# Alpaca Trading Bot — Claude Code Project

## Project Overview
Automated trading bot platform using Alpaca API with Python strategies, a modern web dashboard, and full Docker deployment. Sandbox/production switchable via `.env`.

---

## Architecture

```
alpaca-trading-bot/
├── CLAUDE.md                    # This file
├── .env.example                 # Template for environment variables
├── .env                         # Local env (never commit)
├── docker-compose.yml           # One-command startup
├── docker-compose.prod.yml      # Production override
│
├── strategy/                    # Python — core trading engine
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                  # Bot entrypoint
│   ├── config.py                # Loads env, validates keys
│   ├── broker/
│   │   ├── alpaca_client.py     # Alpaca REST + WebSocket wrapper
│   │   └── order_manager.py     # Order placement, tracking, cancellation
│   ├── strategies/
│   │   ├── base_strategy.py     # Abstract base — all strategies extend this
│   │   ├── registry.py          # Strategy registry — add new ones here
│   │   ├── rsi_mean_reversion.py
│   │   ├── ema_crossover.py
│   │   └── vwap_breakout.py
│   ├── indicators/
│   │   ├── base_indicator.py
│   │   ├── rsi.py
│   │   ├── ema.py
│   │   ├── vwap.py
│   │   └── bollinger.py
│   ├── risk/
│   │   └── risk_manager.py      # Position sizing, max drawdown, stop-loss
│   └── utils/
│       ├── logger.py
│       └── notifier.py          # Alert hooks (Telegram/Discord optional)
│
├── backend/                     # Node.js (Express) or FastAPI — REST API + WebSocket relay
│   ├── Dockerfile
│   ├── package.json             # if Node; or requirements.txt if FastAPI
│   ├── src/
│   │   ├── index.js             # API server entrypoint
│   │   ├── routes/
│   │   │   ├── portfolio.js     # GET /api/portfolio
│   │   │   ├── trades.js        # GET/POST /api/trades
│   │   │   ├── orders.js        # POST /api/orders (manual trading)
│   │   │   ├── strategies.js    # GET/POST /api/strategies (enable/disable)
│   │   │   └── watchlist.js     # GET/POST /api/watchlist
│   │   └── ws/
│   │       └── relay.js         # WebSocket relay for live price feeds
│   └── redis/
│       └── cache.js             # Redis for live data caching
│
├── frontend/                    # React + TypeScript + TailwindCSS + Recharts
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx    # Overview: balance, P&L, active positions
│       │   ├── Trading.tsx      # Manual trade panel + order book
│       │   ├── Strategies.tsx   # Toggle strategies, set params
│       │   ├── Portfolio.tsx    # Holdings, allocation charts
│       │   └── History.tsx      # Trade history, performance metrics
│       └── components/
│           ├── PriceChart.tsx   # Live candlestick chart (lightweight-charts)
│           ├── OrderPanel.tsx   # Buy/sell form with order types
│           ├── PositionTable.tsx
│           └── AlertBanner.tsx
│
├── db/
│   └── init.sql                 # PostgreSQL schema (trades, orders, snapshots)
│
└── nginx/
    └── nginx.conf               # Reverse proxy — single port entry
```

---

## Environment Variables

```bash
# .env.example — copy to .env and fill in

# --- Alpaca ---
ALPACA_MODE=sandbox              # sandbox | production
ALPACA_PAPER_API_KEY=your_paper_key
ALPACA_PAPER_SECRET_KEY=your_paper_secret
ALPACA_LIVE_API_KEY=your_live_key
ALPACA_LIVE_SECRET_KEY=your_live_secret

# --- App ---
BACKEND_PORT=8000
FRONTEND_PORT=3000
JWT_SECRET=change_this_secret

# --- Database ---
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=tradingbot
POSTGRES_USER=trader
POSTGRES_PASSWORD=change_this_password

# --- Redis ---
REDIS_HOST=redis
REDIS_PORT=6379

# --- Strategy Settings ---
DEFAULT_STRATEGIES=rsi_mean_reversion,ema_crossover,vwap_breakout
MAX_POSITION_SIZE_PCT=5          # max % of portfolio per position
MAX_DRAWDOWN_PCT=10              # kill switch threshold
```

---

## Implemented Strategies

### 1. RSI Mean Reversion (`rsi_mean_reversion.py`)
- **Logic:** Buy when RSI < 30 (oversold), sell when RSI > 70 (overbought)
- **Timeframe:** 15-minute bars
- **Indicators:** RSI(14), optional Bollinger Band confirmation
- **Best for:** Range-bound, sideways markets

### 2. EMA Crossover (`ema_crossover.py`)
- **Logic:** Buy on EMA(9) crossing above EMA(21); sell on cross below
- **Timeframe:** 1-hour bars
- **Indicators:** EMA(9), EMA(21), volume confirmation
- **Best for:** Trending markets, momentum plays

### 3. VWAP Breakout (`vwap_breakout.py`)
- **Logic:** Buy when price breaks above VWAP with above-average volume; short/exit when price falls below
- **Timeframe:** 5-minute bars intraday
- **Indicators:** VWAP, volume z-score
- **Best for:** Day trading individual S&P 500 stocks

### Adding a New Strategy
```python
# 1. Create strategy/strategies/my_strategy.py
from strategies.base_strategy import BaseStrategy

class MyStrategy(BaseStrategy):
    name = "my_strategy"
    def generate_signal(self, bars) -> Signal: ...

# 2. Register it
# strategy/strategies/registry.py
from .my_strategy import MyStrategy
REGISTRY["my_strategy"] = MyStrategy
```

---

## Dashboard Features (Frontend)

| Page | Features |
|---|---|
| Dashboard | Live balance, unrealized P&L, daily gain/loss, active positions card, news feed |
| Trading | Buy/sell form, order type (market/limit/stop), order book, recent fills |
| Chart | Candlestick chart with indicator overlays (EMA, VWAP, Bollinger), drawing tools |
| Strategies | Enable/disable each strategy, edit parameters (RSI thresholds, EMA periods), backtest trigger |
| Portfolio | Allocation pie chart, position table, sector breakdown |
| History | Trade log, P&L per trade, win rate, Sharpe ratio, max drawdown chart |
| Alerts | Price alerts, strategy signal notifications |

---

## Running the Project

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your Alpaca paper keys

# 2. Start everything (sandbox mode)
docker-compose up --build

# 3. Open dashboard
open http://localhost:3000

# 4. Switch to production
# Edit .env: ALPACA_MODE=production
docker-compose up --build
```

---

## Key Technical Decisions

- **Strategy engine:** Pure Python with `alpaca-py`, `pandas-ta` for indicators, `apscheduler` for cron-like bar polling
- **Backend:** Node.js (Express) for low-latency WebSocket relay; alternatively FastAPI if you prefer full Python
- **Frontend:** React + TypeScript + TailwindCSS; `lightweight-charts` (TradingView library) for candlesticks; `Recharts` for P&L and portfolio charts
- **Database:** PostgreSQL for trade history and snapshots; Redis for live price caching
- **Docker:** Each service in its own container; Nginx as reverse proxy; single `docker-compose up` starts everything

---

## Claude Code Guidelines

- Always read this file at the start of every session
- Never hardcode API keys — always use `config.py` which reads from `.env`
- When adding a strategy, follow the `BaseStrategy` interface and register in `registry.py`
- All orders must go through `order_manager.py` — never call Alpaca directly from strategy files
- Keep strategy logic pure (no I/O) — strategies return `Signal` objects, the engine executes them
- Frontend API calls go through the backend — never call Alpaca directly from the browser
- Run `docker-compose up --build` to test the full stack before marking any task done
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
