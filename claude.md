# Alpaca Trading Bot — Claude Code Project

## Project Overview
Automated trading bot platform using Alpaca API with Python strategies, a LangGraph agentic pipeline, a Node.js/Express backend, and a React/TypeScript dashboard. Sandbox/production switchable via `.env`.

---

## Architecture

```
vibe_bot/
├── CLAUDE.md                        # This file
├── .env.example                     # Template for environment variables
├── .env                             # Local env (never commit)
├── docker-compose.yml               # One-command startup
├── docker-compose.prod.yml          # Production override
│
├── strategy/                        # Python — core trading engine + agent pipeline
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                      # Bot entrypoint
│   ├── config.py                    # Loads env, validates keys (settings.openai_api_key etc.)
│   ├── broker/
│   │   ├── alpaca_client.py         # Alpaca REST + WebSocket wrapper
│   │   └── order_manager.py         # Order placement, tracking, cancellation
│   ├── strategies/
│   │   ├── base_strategy.py         # Abstract base — Signal, SignalType, BaseStrategy
│   │   ├── registry.py              # Strategy registry — add new strategies here
│   │   ├── rsi_mean_reversion.py
│   │   ├── ema_crossover.py
│   │   └── vwap_breakout.py
│   ├── indicators/
│   │   ├── base_indicator.py
│   │   ├── rsi.py
│   │   ├── ema.py
│   │   ├── vwap.py
│   │   └── bollinger.py
│   ├── agents/                      # LangGraph agentic pipeline (6 agents)
│   │   ├── base_agent.py            # Abstract BaseAgent interface
│   │   ├── orchestrator.py          # LangGraph graph wiring + AgentState
│   │   ├── market_data_agent.py     # Step 1a: fetch bars + compute indicators → MarketSnapshot
│   │   ├── data_qa_agent.py         # Step 1b: quality checks + circuit breaker → QAResult
│   │   ├── news_fetcher_agent.py    # Step 2a: Alpaca News API → NewsSnapshot[]
│   │   ├── news_analysis_agent.py   # Step 2b: OpenAI structured output → NewsSentiment per symbol
│   │   ├── signal_selection_agent.py# Step 3: runs rule-based signals + GPT-4o-mini → SignalSelectionResult
│   │   └── risk_agent.py            # Step 4: position sizing, stop-loss, profit target → RiskAllocation
│   ├── risk/
│   │   └── risk_manager.py
│   ├── utils/
│   │   ├── logger.py
│   │   └── notifier.py              # Telegram/Discord alert hooks
│   └── tests/
│       ├── test_strategies.py
│       ├── test_market_data_agent.py
│       ├── test_data_qa_agent.py
│       ├── test_news_fetcher_agent.py
│       ├── test_news_analysis_agent.py
│       └── test_signal_selection_agent.py
│
├── backend/                         # Node.js (Express) — REST API + WebSocket relay
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── index.js                 # Express server entrypoint
│   │   ├── routes/
│   │   │   ├── auth.js              # POST /api/auth/login (JWT)
│   │   │   ├── portfolio.js         # GET /api/portfolio (Redis-cached)
│   │   │   ├── trades.js            # GET /api/trades (PostgreSQL history)
│   │   │   ├── orders.js            # GET/POST /api/orders (Alpaca)
│   │   │   ├── quote.js             # GET /api/quote/:symbol
│   │   │   ├── chart.js             # GET /api/chart/:symbol
│   │   │   ├── assets.js            # GET /api/assets (symbol search)
│   │   │   ├── strategies.js        # GET/POST /api/strategies
│   │   │   ├── indicators.js        # GET/PATCH /api/indicators (chart overlay config)
│   │   │   ├── watchlist.js         # GET/POST /api/watchlist
│   │   │   ├── news.js              # GET /api/news
│   │   │   ├── agent.js             # GET /api/agent/status, POST /api/agent/run
│   │   │   └── backtest.js          # GET /api/backtest (JS strategy simulators)
│   │   └── ws/
│   │       └── relay.js             # WebSocket relay for live price feeds
│   └── redis/
│       └── cache.js
│
├── frontend/                        # React + TypeScript + TailwindCSS
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── Landing.tsx          # Marketing/landing page
│       │   ├── Login.tsx            # JWT login form
│       │   ├── Dashboard.tsx        # Main trading view (chart + bottom panel tabs)
│       │   ├── Trading.tsx          # Manual trade panel + order book
│       │   ├── Strategies.tsx       # Strategy config, indicators, monitor, backtest
│       │   ├── Portfolio.tsx        # Holdings, allocation charts, P&L analysis
│       │   └── History.tsx          # Trade history, performance metrics
│       ├── components/
│       │   ├── PriceChart.tsx       # Candlestick/line chart (lightweight-charts)
│       │   ├── PortfolioSummary.tsx # Top stats bar incl. AI Signal card
│       │   ├── OrderPanel.tsx       # Buy/sell form
│       │   ├── PositionTable.tsx
│       │   ├── AlertBanner.tsx
│       │   └── SymbolSearch.tsx
│       └── lib/
│           ├── format.ts
│           └── socket.ts
│
├── db/
│   └── init.sql                     # PostgreSQL schema
├── nginx/
│   └── nginx.conf
└── noted/                           # Developer notes and documentation
    ├── backtest_logic.md
    ├── vibe_bot_agentic_prompt.md
    └── vectorDB.md
```

---

## Environment Variables

```bash
# .env.example — copy to .env and fill in

# --- Alpaca ---
ALPACA_MODE=sandbox              # sandbox | production
ALPACA_PAPER_API_KEY=
ALPACA_PAPER_SECRET_KEY=
ALPACA_LIVE_API_KEY=
ALPACA_LIVE_SECRET_KEY=

# --- OpenAI (required for agent pipeline) ---
OPENAI_API_KEY=                  # used by NewsAnalysisAgent + SignalSelectionAgent

# --- App ---
BACKEND_PORT=8000
FRONTEND_PORT=3000
JWT_SECRET=change_this_secret
DASHBOARD_PASSWORD=              # simple password for login page

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
MAX_POSITION_SIZE_PCT=5
MAX_DRAWDOWN_PCT=10

# --- Notifications (optional) ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
```

---

## Implemented Strategies

### 1. RSI Mean Reversion (`rsi_mean_reversion.py`)
- **Logic:** Buy when RSI < 30 (oversold), sell when RSI > 70 (overbought)
- **Timeframe:** 15-minute bars (live); daily bars in backtest
- **Indicators:** RSI(14), optional Bollinger Band confirmation

### 2. EMA Crossover (`ema_crossover.py`)
- **Logic:** Buy on EMA(9) crossing above EMA(21) with volume confirmation; sell on reverse cross
- **Timeframe:** 1-hour bars (live); daily bars in backtest
- **Indicators:** EMA(9), EMA(21), rolling volume average

### 3. VWAP Breakout (`vwap_breakout.py`)
- **Logic:** Buy when price breaks above VWAP with volume z-score > 1.5; exit when price falls below
- **Timeframe:** 5-minute bars intraday (live); rolling-window VWAP in backtest
- **Indicators:** VWAP, volume z-score

### Adding a New Strategy
```python
# 1. Create strategy/strategies/my_strategy.py
from strategies.base_strategy import BaseStrategy, Signal, SignalType

class MyStrategy(BaseStrategy):
    name = "my_strategy"
    def generate_signal(self, symbol: str, bars: pd.DataFrame) -> Signal: ...

# 2. Register it in strategy/strategies/registry.py
from .my_strategy import MyStrategy
REGISTRY["my_strategy"] = MyStrategy
```

---

## Agent Pipeline (LangGraph)

The agentic pipeline runs on a schedule (or manually via `POST /api/agent/run`). All state flows through `AgentState` (TypedDict) in `orchestrator.py`.

```
MarketDataFetcherAgent  →  DataQAAgent  →  NewsFetcherAgent
                                         ↓
                              NewsAnalysisAgent  →  SignalSelectionAgent
```

| Agent | Output key | Description |
|---|---|---|
| `MarketDataFetcherAgent` | `market_snapshots` | Fetches OHLCV bars, computes RSI/EMA/VWAP indicators |
| `DataQAAgent` | `qa_result` | Hard-fail and quality checks; sets circuit breaker |
| `NewsFetcherAgent` | `news_snapshots` | Alpaca News API, last 24h, up to 10 articles/symbol |
| `NewsAnalysisAgent` | `news_sentiments` | gpt-4o-mini structured output → sentiment score + themes |
| `SignalSelectionAgent` | `signal_selections` | Runs all 3 strategies as evidence, calls gpt-4o-mini → BUY/SELL/NO_TRADE |
| `RiskCapitalAllocationAgent` | `risk_allocations` | GPT-4o-mini → position size %, stop-loss, profit target per symbol |

**Signal selection confidence gate:** direction is forced to `NO_TRADE` if `confidence < 0.65`.

**Agent status** is written to Redis key `agent:status` and read by `GET /api/agent/status`.

---

## Backtest System

The backtest is a **pure Node.js reimplementation** in `backend/src/routes/backtest.js`. It is independent of the live Python strategies.

**Endpoint:** `GET /api/backtest?symbols=SPY,AAPL&strategy=all&timeframe=3m&days=90`

- `timeframe`: `1m` (60d) | `3m` (120d) | `6m` (210d) | `1y` (400d)
- `days`: custom day count (overrides timeframe)
- All strategies run on **daily bars** regardless of their live timeframe
- Fills at `bars[i+1].open` (next-bar execution, no look-ahead bias)

**Stats returned per strategy:** total return %, win rate, loss rate, max drawdown, Sharpe, profit factor, avg win/loss, best/worst trade, unrealized P&L, ending balance (on $10k).

---

## Dashboard Features

### Dashboard page (`Dashboard.tsx`)
- Top bar: Portfolio Value, Invested, Cash, Unrealized P&L, Positions, AI Signal (from `signal_selections`)
- Chart header: symbol, price, AI Signal badge (BUY/SELL/NO_TRADE + confidence)
- Bottom panel (draggable, collapsible) with 7 tabs:

| Tab | Content |
|---|---|
| Positions | Open positions table |
| Orders | Order history |
| Activity | Live strategy signal feed (WebSocket) |
| News | Live news feed for active symbol |
| Agents | Pipeline status, QA card counts, Run Now button |
| News Analysis | Per-symbol news sentiment with expandable details |
| Signals | Per-symbol AI signal decisions with reasoning |

### Strategies page (`Strategies.tsx`)
- **Trading tab:** Enable/disable strategies, edit parameters
- **Indicators tab:** Configure chart overlay indicators
- **Monitor tab:** Live strategy signal monitor
- **Backtest Monitor tab:** Run simulated backtests with custom timeframe/days, per-strategy performance cards

### Portfolio page (`Portfolio.tsx`)
- Allocation pie chart, treemap, position table
- Unrealized P&L bar chart (toggle $ / % scale)

---

## Running the Project

```bash
# 1. Configure
cp .env.example .env
# Fill in ALPACA_PAPER_API_KEY, ALPACA_PAPER_SECRET_KEY, OPENAI_API_KEY

# 2. Start everything
docker-compose up --build

# 3. Open dashboard
open http://localhost:3000

# 4. Run tests (Python agents)
cd strategy && python -m pytest tests/ -v
```

---

## Key Technical Decisions

- **Agent pipeline:** LangGraph (`StateGraph`) with 5 agents; state is a `TypedDict`; agents are pure functions `(state: dict) -> dict`
- **LLM calls:** OpenAI `gpt-4o-mini` with `beta.chat.completions.parse` (structured output via Pydantic). System prompts are kept constant for automatic prompt caching.
- **Backtest:** JS reimplementation in `backtest.js` — independent of Python strategies, runs on daily bars only
- **Backend:** Node.js/Express for low-latency WebSocket relay; Redis for live data caching; PostgreSQL for trade history
- **Frontend:** React + TypeScript + TailwindCSS; `lightweight-charts` for candlesticks; `Recharts` for P&L/portfolio charts
- **Agent status:** Written to Redis `agent:status` key by Python worker; polled every 10–15s by frontend

---

## Claude Code Guidelines

- Always read this file at the start of every session
- Never hardcode API keys — always use `config.py` (Python) or `process.env` (Node.js)
- When adding a strategy, extend `BaseStrategy`, implement `generate_signal`, and register in `registry.py`
- All orders must go through `order_manager.py` — never call Alpaca directly from strategy or agent files
- Keep strategy logic pure (no I/O) — strategies return `Signal` objects, the engine executes them
- Agent output keys: `market_snapshots`, `qa_result`, `news_snapshots`, `news_sentiments`, `signal_selections`
- Frontend API calls go through the backend — never call Alpaca directly from the browser
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
- Run `docker-compose up --build` to test the full stack before marking any task done
