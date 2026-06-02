# Claude Code — Initial Bootstrap Prompt

Paste this as your **first message** when starting a new Claude Code session on this project.

---

## Prompt

```
Read CLAUDE.md fully before doing anything.

You are building an automated stock trading bot platform. Here is the full spec:

**Project:** Alpaca Trading Bot
**Stack:**
- Strategy engine: Python 3.12, alpaca-py, pandas, pandas-ta, apscheduler
- Backend: Node.js + Express + Socket.io (WebSocket relay)
- Frontend: React + TypeScript + TailwindCSS + lightweight-charts + Recharts
- Database: PostgreSQL + Redis
- Infrastructure: Docker + docker-compose + Nginx reverse proxy

**Phase 1 — Scaffold the full project structure**

Create every file and directory listed in CLAUDE.md's Architecture section. For each file:
- Add the correct imports and a clear module docstring
- Implement stubs with TODO comments where logic goes
- Make sure every file is importable/runnable without errors

Start with these files in order:
1. .env.example
2. docker-compose.yml
3. strategy/config.py (loads .env, selects sandbox vs production Alpaca keys)
4. strategy/broker/alpaca_client.py (wraps alpaca-py: account info, bars, orders, WebSocket stream)
5. strategy/strategies/base_strategy.py (abstract BaseStrategy with Signal dataclass)
6. strategy/strategies/registry.py
7. strategy/strategies/rsi_mean_reversion.py
8. strategy/strategies/ema_crossover.py
9. strategy/strategies/vwap_breakout.py
10. strategy/risk/risk_manager.py (position sizing, max drawdown kill switch)
11. strategy/main.py (scheduler loop: fetch bars → run strategies → execute signals)
12. backend/src/index.js (Express server + Socket.io)
13. backend/src/routes/ (all 5 route files)
14. frontend/src/App.tsx + all pages + components
15. nginx/nginx.conf
16. db/init.sql

After scaffolding, verify docker-compose up --build works end-to-end.
```

---

## Follow-up Prompts (use these in sequence after Phase 1)

### Phase 2 — Implement Strategy Engine
```
Implement the full strategy engine. Requirements:

1. alpaca_client.py: implement get_account(), get_bars(symbol, timeframe, limit), 
   place_order(symbol, qty, side, order_type, limit_price), get_positions(), 
   stream_quotes(symbols, callback)

2. Implement all 3 strategies fully:
   - RSI Mean Reversion: RSI(14) on 15min bars, buy <30, sell >70, 
     with Bollinger Band confirmation option
   - EMA Crossover: EMA(9) vs EMA(21) on 1hr bars, crossover signal with volume filter
   - VWAP Breakout: 5min bars intraday, buy on VWAP breakout with volume z-score > 1.5

3. risk_manager.py: implement
   - position_size(symbol, signal_strength) → qty using % of portfolio
   - check_drawdown() → bool (True = kill switch triggered)
   - daily_loss_limit() → bool

4. main.py: implement the scheduler loop using APScheduler
   - Every 1 min: stream live quotes to Redis
   - Every 5 min: run VWAP strategy
   - Every 15 min: run RSI strategy  
   - Every 1 hr: run EMA strategy
   - On signal: call risk_manager, then order_manager

All strategies must be independently testable with: python -m pytest strategy/tests/
```

### Phase 3 — Backend API
```
Implement the full Express backend:

1. GET /api/account — return balance, buying power, portfolio value from Alpaca
2. GET /api/positions — current open positions with unrealized P&L
3. GET /api/orders?status=open|closed — order history
4. POST /api/orders — place a manual order { symbol, qty, side, type, limit_price? }
5. DELETE /api/orders/:id — cancel an order
6. GET /api/strategies — list all strategies with enabled/disabled status and params
7. PATCH /api/strategies/:name — enable/disable a strategy or update its params
8. GET /api/history — trade history from PostgreSQL with P&L per trade
9. GET /api/chart/:symbol?timeframe=1D — OHLCV bars for charting

WebSocket (Socket.io):
- Relay live quote stream from Redis to connected browser clients
- Emit: quote, order_update, signal_fired, position_change events

Protect all routes with JWT middleware (header: Authorization: Bearer <token>)
POST /api/auth/login → returns JWT given a password set in .env
```

### Phase 4 — Frontend Dashboard
```
Build the full React frontend dashboard. Requirements:

Design: Dark theme, professional trading terminal aesthetic similar to modern 
trading platforms. Use TailwindCSS. Primary color: indigo/violet. 
Accent: green for gains, red for losses.

Pages to implement:

1. Dashboard (/) 
   - Top bar: Account value, daily P&L (+/-%), buying power, margin used
   - Main area: TradingView lightweight-charts candlestick for default symbol (SPY)
   - Right panel: Open positions table (symbol, qty, avg price, current, P&L%)
   - Bottom: Recent orders feed + strategy signal log

2. Trading (/trading)
   - Symbol search + watchlist (add/remove symbols)
   - Order panel: Buy/Sell tabs, Market/Limit/Stop order type selector,
     quantity input, estimated cost, confirmation modal
   - Order book table
   - Recent fills

3. Strategies (/strategies)
   - Card per strategy (RSI, EMA, VWAP)
   - Toggle on/off switch
   - Editable params (RSI period, thresholds, etc.)
   - Last signal fired + P&L attribution per strategy
   - "Add Strategy" placeholder card

4. Portfolio (/portfolio)
   - Donut chart: allocation by position
   - Bar chart: sector breakdown
   - Performance line chart: portfolio value over time (30d)
   - Holdings table with sort/filter

5. History (/history)
   - Trade log table (date, symbol, side, qty, price, P&L)
   - Summary stats: total trades, win rate, avg win, avg loss, Sharpe ratio
   - P&L curve chart

Use React Query for all API calls. Use Socket.io-client for live updates.
All number formatting: use locale strings, green/red color coding, +/- prefix.
```

### Phase 5 — Docker & Production Readiness
```
Finalize Docker setup and make production-ready:

1. docker-compose.yml: services = strategy, backend, frontend, db (postgres), 
   redis, nginx. All connected via internal network. Only nginx exposes port 80.

2. docker-compose.prod.yml override: production API keys, NODE_ENV=production,
   React build (not dev server), restart: always policies

3. Nginx config:
   - / → proxy to frontend:3000
   - /api → proxy to backend:8000
   - /ws → proxy WebSocket to backend:8000
   - Gzip compression, cache static assets

4. Each Dockerfile: multi-stage builds, non-root user, health checks

5. db/init.sql: create tables
   - trades (id, symbol, side, qty, price, filled_at, strategy, pnl)
   - orders (id, alpaca_order_id, symbol, side, qty, type, status, created_at)
   - portfolio_snapshots (id, timestamp, total_value, cash, positions_json)
   - strategy_signals (id, strategy_name, symbol, signal, timestamp, executed)

6. Add Makefile with shortcuts:
   make up        → docker-compose up --build
   make down      → docker-compose down
   make logs      → docker-compose logs -f
   make test      → run pytest in strategy container
   make shell     → bash into strategy container

Final check: docker-compose up --build from a clean clone should bring up 
the full stack with no errors. Dashboard accessible at http://localhost.
```
