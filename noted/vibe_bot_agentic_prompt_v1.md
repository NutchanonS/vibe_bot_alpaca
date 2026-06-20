# Agentic AI Trading System — Claude Code Prompt Playbook

Reference: https://medium.com/predict/building-an-agentic-ai-trading-system-from-end-to-end-0fbc0a95b2e2

## Architecture Map: Existing → Agentic

```
CURRENT                          AGENTIC UPGRADE
──────────────────────────────────────────────────────────────
alpaca_client.py          →  Agent 1:  MarketDataFetcher
(no news)                 →  Agent 1b: NewsFetcher          ← NEW (parallel with 1)
(no validation)           →  Agent 2:  DataQA + CircuitBreaker
(no news analysis)        →  Agent 2b: NewsAnalysis (LLM)  ← NEW (parallel with 2)
rsi/ema/vwap strategies   →  Agent 3:  SignalSelection (LLM + news sentiment)
risk_manager.py           →  Agent 4:  RiskCapitalAllocation (LLM)
(none)                    →  Agent 5:  PolicySelfCritic (LLM)
order_manager.py          →  Agent 6:  ExecutionAgent (deterministic)
(none)                    →  Agent 7:  PositionManager (LLM)
(none)                    →  LangGraph: orchestrator loop
backend/routes/           →  New: /api/agent/status + /api/agent/run + /api/news
frontend/                 →  New: News tab in Dashboard + AgentLog panel
```

### Data flow with news:

```
  ┌─ Agent 1: MarketDataFetcher ─┐
  │                               ├─→ Agent 2: DataQA ─→ Agent 3: SignalSelection ─→ ...
  └─ Agent 1b: NewsFetcher ───────┘        ↑
                                    Agent 2b: NewsAnalysis (LLM)
                                    feeds sentiment into SignalSelection
```

## Recommended Build Order Summary

| Step | Agent | LLM? | Complexity | Builds On |
|------|-------|-------|------------|-----------|
| 1    | MarketDataFetcher            | No           | Low    | alpaca_client |
| 1b   | NewsFetcher                  | No           | Low    | Alpaca News API (same keys) |
| 2    | DataQA + CircuitBreaker      | No           | Low    | Step 1 |
| 2b   | NewsAnalysis                 | Yes (OpenAI gpt-4o-mini) | Medium | Step 1b + Step 2 |
| 3    | SignalSelection               | Yes (OpenAI gpt-4o-mini) | Medium | Steps 1-2, 2b + strategies/ |
| 4    | RiskCapital                  | Yes (OpenAI gpt-4o-mini) | Medium | Steps 1-3 + risk_manager |
| 5    | PolicySelfCritic             | Yes (OpenAI gpt-4o-mini) | Medium | Steps 1-4 |
| 6    | Execution                    | No                       | Low    | Steps 1-5 + order_manager |
| 7    | PositionManager              | Yes (OpenAI gpt-4o-mini) | High   | Steps 1-6 + DB |
| 8    | LangGraph Orchestrator       | No           | High   | All agents |
| 9    | Frontend Agent + News Panel  | No           | Low    | Steps 8 + 1b |

---

## Step 1 — Market Data Fetcher Agent

**Build first because:** no LLM, no external deps beyond what you already have, validates the agent interface contract.

```
I'm upgrading an Alpaca trading bot to a LangGraph multi-agent system.
This is STEP 1 of 7: the MarketDataFetcher agent.

Context:
- Repo is at c:\works\vibe_bot
- strategy/broker/alpaca_client.py already wraps Alpaca REST
- strategy/config.py loads env vars
- No LangGraph installed yet — add it to requirements.txt

Task:
Create strategy/agents/market_data_agent.py

The agent must:
1. Accept a list of symbols and a lookback (default 50 bars, 15-min timeframe)
2. Call alpaca_client to fetch OHLCV bars for each symbol
3. Compute RSI(14), EMA(9), EMA(21), VWAP (from strategy/indicators/) for each symbol
4. Return a typed MarketSnapshot dataclass with fields:
   symbol, timestamp, bars (pd.DataFrame), indicators (dict),
   latest_price, avg_volume_20, data_quality_score (0.0-1.0)
5. data_quality_score = 1.0 if bars >= 30 and no NaN in indicators, else proportionally lower

Also create strategy/agents/__init__.py and strategy/agents/base_agent.py
with an abstract BaseAgent(ABC) that has: name, run(state: dict) -> dict

No LLM calls in this agent. Pure data gathering.
Add pytest unit test at strategy/tests/test_market_data_agent.py
using mock data (no real API calls in tests).
```

---

## Step 2 — Data QA & Circuit Breaker Agent

**Build second because:** still no LLM, teaches the "agent can block downstream" pattern that the whole system relies on.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 2 of 7: the DataQA and CircuitBreaker agent.

Context:
- strategy/agents/base_agent.py exists (from step 1)
- strategy/agents/market_data_agent.py exists (from step 1)
- MarketSnapshot dataclass exists with data_quality_score

Task:
Create strategy/agents/data_qa_agent.py

The agent must:
1. Accept a list of MarketSnapshot objects
2. For each snapshot, check:
   - data_quality_score >= 0.7 (else flag as DEGRADED)
   - latest_price > 0
   - bars has no all-NaN columns
   - timestamp is within last 20 minutes (stale data check)
3. Return a QAResult dataclass:
   approved_symbols: list[str]  # passed all checks
   degraded_symbols: list[str]  # low quality but usable
   blocked_symbols: list[str]   # failed hard checks
   circuit_break: bool          # True if >50% of symbols fail
   report: str                  # human-readable summary

4. If circuit_break=True, the agent should log a WARNING via
   strategy/utils/logger.py and the orchestrator must halt that cycle.

No LLM calls. Add tests at strategy/tests/test_data_qa_agent.py.
```

---

## Step 1b — News Fetcher Agent

**Build alongside Step 1/2 because:** no LLM, uses the same Alpaca API keys already configured, runs in parallel with market data fetching. News adds context that improves SignalSelection in Step 3.

```
I'm building a LangGraph multi-agent trading system.
This is Step 1b: the NewsFetcher agent (no LLM, parallel with MarketDataFetcher).

Context:
- strategy/agents/base_agent.py exists (BaseAgent ABC with run(state) -> dict)
- strategy/config.py has settings.api_key and settings.secret_key
- Alpaca News API: GET https://data.alpaca.markets/v1beta1/news
  Params: symbols (comma-separated), start (ISO8601), limit, sort=desc
  Auth: same APCA-API-KEY-ID / APCA-API-SECRET-KEY headers
  Response: { "news": [{ id, headline, summary, source, author, url, symbols, created_at }] }

Task:
Create strategy/agents/news_fetcher_agent.py

Define these dataclasses:
  NewsArticle:
    id: int
    headline: str
    summary: str
    source: str
    author: str
    url: str
    symbols: list[str]
    created_at: datetime
    sentiment: float | None  # filled later by NewsAnalysisAgent

  NewsSnapshot:
    symbol: str
    articles: list[NewsArticle]
    fetched_at: datetime

The NewsFetcherAgent must:
1. Accept symbols from state["symbols"]
2. Fetch articles from Alpaca News API using requests
   - lookback_hours param (default 24h), limit_per_symbol (default 10)
   - batch all symbols in one request (symbols=AAPL,SPY,...)
3. Group returned articles by symbol (one article can match multiple symbols)
4. Return state with "news_snapshots": list[NewsSnapshot]
5. On API failure: return empty snapshots, log error, DO NOT raise

Also add /api/news to backend/src/routes/news.js (Node.js):
  GET /api/news?symbols=AAPL,SPY&limit=20&hours=24
  Proxies Alpaca v1beta1/news with same auth pattern as chart.js.
  Register in backend/src/index.js.

Add a News tab to the Dashboard.tsx bottom tab bar (4th tab):
  - Fetch GET /api/news?symbols=<activeSymbol>&limit=20
  - Show list: headline | source | symbols | relative time (e.g. "2h ago")
  - Clicking headline opens url in new tab
  - Auto-refresh every 5 minutes
  - Show sentiment badge (Bullish/Bearish/Neutral) when available from NewsAnalysisAgent

Add tests at strategy/tests/test_news_fetcher_agent.py using mock responses.
```

---

## Step 2b — News Analysis Agent (LLM)

**Build after Step 1b and Step 2 because:** needs QA-approved symbols to know which news is trustworthy, and uses OpenAI to produce structured sentiment that feeds into SignalSelection.

```
I'm building a LangGraph multi-agent trading system.
This is Step 2b: the NewsAnalysis agent — LLM-powered sentiment extraction.

Context:
- strategy/agents/news_fetcher_agent.py exists (NewsSnapshot, NewsArticle)
- strategy/agents/data_qa_agent.py exists (QAResult with approved_symbols)
- strategy/config.py has settings.openai_api_key (loaded from OPENAI_API_KEY in .env)
- Add openai>=1.56.0 to requirements.txt if not already present
- Model: gpt-4o-mini  (fast, cheap, supports structured outputs)

OpenAI structured output pattern (use this, not function calling):
  from openai import OpenAI
  from pydantic import BaseModel

  client = OpenAI(api_key=settings.openai_api_key)
  result = client.beta.chat.completions.parse(
      model="gpt-4o-mini",
      messages=[{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt}],
      response_format=NewsSentiment,  # Pydantic model
  )
  sentiment = result.choices[0].message.parsed

Note: OpenAI automatically caches repeated system prompt prefixes (no explicit
cache_control needed). Keep the system prompt constant across calls for the same
agent so OpenAI's automatic caching applies.

Task:
Create strategy/agents/news_analysis_agent.py

Define as a Pydantic BaseModel (required for structured output):
  class NewsSentiment(BaseModel):
    symbol: str
    overall_sentiment: float      # -1.0 (very bearish) to +1.0 (very bullish)
    confidence: float             # 0.0 to 1.0
    key_themes: list[str]         # e.g. ["earnings beat", "guidance raised"]
    risk_events: list[str]        # e.g. ["SEC investigation", "product recall"]
    bullish_reasons: list[str]
    bearish_reasons: list[str]
    articles_analyzed: int
    summary: str                  # 1-2 sentence human-readable summary

The NewsAnalysisAgent must:
1. Accept state["news_snapshots"] and state["qa_result"].approved_symbols
2. Skip symbols with zero articles (return sentiment=0.0, confidence=0.0)
3. Only analyze symbols in approved_symbols (skip blocked ones)
4. For each symbol with articles, build:
   - SYSTEM_PROMPT (constant — same every call so OpenAI caches it):
     "You are a financial news analyst. Extract sentiment signals from news
      headlines and summaries. Be precise and conservative."
   - user_prompt: headlines + summaries (truncated to 200 chars each, max 5 articles)
5. Call gpt-4o-mini using client.beta.chat.completions.parse()
   with response_format=NewsSentiment
6. Return state with "news_sentiments": dict[str, NewsSentiment]

IMPORTANT: If OpenAI fails or times out for a symbol, return neutral sentiment
(overall_sentiment=0.0, confidence=0.0) and log the error. Never block the pipeline.

Update Step 3 (SignalSelection) to also receive news_sentiments:
  - Add to the prompt: "News sentiment for {symbol}: {sentiment.overall_sentiment:+.2f}
    (confidence {sentiment.confidence:.0%}). Themes: {themes}. Risks: {risks}."
  - If sentiment.overall_sentiment < -0.5 and confidence > 0.7: add to conflicting_signals
  - If sentiment.overall_sentiment > 0.5 and confidence > 0.7: add to supporting_signals

Add tests mocking the OpenAI response.
```

---

## Step 3 — Signal Selection Agent (First LLM Agent)

**Build third because:** first OpenAI call. Builds on existing rule-based strategy signals as "evidence" for the LLM to reason over. Also receives news sentiment from Step 2b.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 3 of 7: the SignalSelection agent — the first LLM-powered agent.

Context:
- strategy/agents/base_agent.py, market_data_agent.py, data_qa_agent.py exist
- strategy/strategies/ has RSI, EMA, VWAP rule-based strategies
- strategy/indicators/ has RSI, EMA, VWAP, Bollinger implementations
- strategy/config.py has settings.openai_api_key (from OPENAI_API_KEY in .env)
- openai>=1.56.0 is in requirements.txt
- Model: gpt-4o-mini

OpenAI structured output pattern:
  from openai import OpenAI
  from pydantic import BaseModel
  from typing import Literal

  client = OpenAI(api_key=settings.openai_api_key)
  result = client.beta.chat.completions.parse(
      model="gpt-4o-mini",
      messages=[{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt}],
      response_format=SignalSelectionResult,
  )
  output = result.choices[0].message.parsed

Note: keep SYSTEM_PROMPT constant so OpenAI's automatic caching applies.

Task:
Create strategy/agents/signal_selection_agent.py

Output schema (Pydantic BaseModel):
  class SignalSelectionResult(BaseModel):
    symbol: str
    direction: Literal["BUY", "SELL", "NO_TRADE"]
    confidence: float             # 0.0-1.0
    reasoning: str                # 2-3 sentences max
    supporting_signals: list[str] # which strategies agreed
    conflicting_signals: list[str]# which strategies disagreed

The agent must:
1. Accept approved MarketSnapshot objects (from QA agent) + news_sentiments (from step 2b)
2. For each symbol, run ALL existing rule-based strategies
   (RSI, EMA, VWAP) to get their Signal objects — use these as EVIDENCE
3. Build user prompt including:
   - Current price, RSI value, EMA(9) vs EMA(21), VWAP relationship
   - All strategy signals with their strength scores
   - 5-bar price momentum summary
   - News sentiment if available: "Sentiment: {overall_sentiment:+.2f} ({confidence:.0%} confidence)"
4. Call gpt-4o-mini with response_format=SignalSelectionResult
5. IMPORTANT: Force direction="NO_TRADE" if confidence < 0.65 (override LLM if needed)

Add tests mocking the OpenAI response.
```

---

## Step 4 — Risk & Capital Allocation Agent

**Build fourth because:** takes the approved signal and sizes the position — uses LLM to reason about context but enforces hard limits deterministically.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 4 of 7: the Risk & Capital Allocation agent.

Context:
- strategy/risk/risk_manager.py exists with position sizing logic
- strategy/agents/signal_selection_agent.py exists with SignalSelectionResult
- Backend has /api/portfolio route that returns equity, cash, positions

Task:
Create strategy/agents/risk_agent.py

The agent must:
1. Accept: SignalSelectionResult + current portfolio snapshot (equity, cash, open positions)
2. Enforce hard rules BEFORE any LLM call (deterministic guardrails):
   - Max position size = MAX_POSITION_SIZE_PCT from config (default 5%)
   - If already holding symbol, max add = 2% of equity
   - If total open positions >= 5, reject new BUY signals
   - Max single-trade risk = 1.5% of equity (stop-loss distance check)
3. If passes hard rules, call gpt-4o-mini (OpenAI) to reason about:
   - Suggested position size given confidence score and volatility (use ATR from bars)
   - Whether current market conditions warrant reduced sizing
   - Stop-loss price and profit target price
   Use client.beta.chat.completions.parse() with a Pydantic RiskAllocation model.
4. Return RiskAllocation dataclass:
     approved: bool
     symbol: str
     qty: int
     entry_price: float
     stop_loss: float
     profit_target: float
     risk_pct: float
     reasoning: str
     rejection_reason: str | None

Hard rules MUST override LLM output — if LLM suggests 10 shares
but hard rule caps at 5, output 5.
Keep system prompt constant — OpenAI caches repeated prefixes automatically.
Add tests mocking the OpenAI response.
```

### Step 4 Practical Wiring Notes (Implemented)

- The orchestrator now includes a dedicated `portfolio_snapshot` node before `risk_allocation`.
- Current graph order is:
  - `market_data -> data_qa -> news_fetch -> news_analysis -> signal_selection -> portfolio_snapshot -> risk_allocation -> END`
- `portfolio_snapshot` pulls live account/position data from Alpaca (`get_account()`, `get_positions()`) and injects normalized `state["portfolio"]`:
  - `equity`, `cash`, `buying_power`, `positions[]`
- On portfolio fetch failure, orchestrator logs the error and injects a safe zeroed fallback portfolio instead of crashing the cycle.
- Agent status payload now includes:
  - compact `portfolio` summary (`equity`, `cash`, `buying_power`, `positions_count`)
  - `risk_allocations` output map
- Guardrail behavior is deterministic and enforced as hard overrides after LLM output:
  - max position size from config
  - max add size for existing holdings
  - max open positions for new BUY
  - max single-trade risk from stop-loss distance

---

## Step 5 — Policy & Self-Critic Agent

**Build fifth because:** independent second opinion — the most "agentic" behavior, requires no new data sources.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 5 of 7: the Policy & Self-Critic agent.

Context:
- All previous agents exist (market_data, data_qa, signal_selection, risk)
- This agent gets ALL previous agent outputs and looks for reasons to VETO

Task:
Create strategy/agents/policy_critic_agent.py

The agent must:
1. Accept the full pipeline state:
   MarketSnapshot + QAResult + SignalSelectionResult + RiskAllocation
2. Call gpt-4o-mini with a DIFFERENT system prompt than the Signal agent —
   this agent's persona is a risk-averse compliance officer whose job is to
   find reasons NOT to trade.
   Use client.beta.chat.completions.parse() with a Pydantic PolicyReview model.
3. The prompt must explicitly instruct the LLM to:
   - Look for contradictions between agents' outputs
   - Check if confidence + risk_pct combination is acceptable
   - Flag if signal reasoning relies on a single indicator
   - Be skeptical — a VETO is a valid and encouraged output
4. Return PolicyReview dataclass:
     verdict: Literal["APPROVED", "VETOED", "APPROVED_WITH_CAUTION"]
     veto_reasons: list[str]
     caution_notes: list[str]
     confidence_adjustment: float  # -0.2 to +0.0 only (can reduce, not increase)

5. If vetoed, the orchestrator SKIPS execution for that symbol this cycle.
   Log the veto reason to DB via a new endpoint POST /api/agent/veto

Keep system prompt constant and different from the signal agent's system
prompt — OpenAI caches them independently as separate prefix entries.
Add tests mocking the OpenAI response.
```

---

## Step 6 — Execution Agent

**Build sixth because:** deterministic wrapper — no LLM, just safe order placement.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 6 of 7: the Execution agent.

Context:
- strategy/broker/order_manager.py exists with place_order(), cancel_order()
- RiskAllocation dataclass exists from step 4
- PolicyReview exists from step 5

Task:
Create strategy/agents/execution_agent.py

The agent must:
1. Accept: RiskAllocation + PolicyReview
2. ONLY execute if PolicyReview.verdict != "VETOED"
3. Place order via order_manager.py (never call Alpaca directly):
   - Market order for the qty specified in RiskAllocation
   - Immediately place a stop-loss limit order at RiskAllocation.stop_loss
4. Return ExecutionResult dataclass:
     executed: bool
     order_id: str | None
     stop_order_id: str | None
     skipped_reason: str | None
     timestamp: datetime
     full_pipeline_state: dict  # serialized JSON of all agent outputs

5. Save full_pipeline_state to PostgreSQL via a new table:
   agent_cycles (id, symbol, timestamp, snapshot, cycle_json, executed)
   Add migration to db/init.sql

6. Emit a WebSocket event "agent_decision" via the backend relay
   so the frontend can show it in real time.

No LLM calls. Add tests.
```

---

## Step 7 — Position Manager Agent

**Build seventh because:** the most stateful agent — manages trades already in flight across multiple cycles.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 7 of 7: the Position Manager agent.

Context:
- All 6 previous agents exist
- order_manager.py has cancel_order(), place_order()
- Backend /api/portfolio returns open positions
- agent_cycles table exists in PostgreSQL

Task:
Create strategy/agents/position_manager_agent.py

The agent must:
1. Run EVERY cycle, independent of new signal flow
2. Fetch all open positions from Alpaca
3. For each position, fetch the original entry thesis from agent_cycles table
4. Call gpt-4o-mini and ask: given the ORIGINAL reasoning
   and CURRENT price/indicators, should we:
   Use client.beta.chat.completions.parse() with a Pydantic PositionDecision model.
   - HOLD (thesis intact)
   - EXIT (thesis broken, price action contradicts entry reasoning)
   - TRAIL_STOP (move stop-loss up to lock in gains)
5. If current unrealized P&L > 2x original risk_pct: force TRAIL_STOP
   (deterministic override regardless of LLM output)
6. If position age > 3 trading days with no profit: force EXIT
   (deterministic override)
7. Return list[PositionDecision]:
     symbol, action, new_stop_price, exit_reason, reasoning

Keep system instructions constant (OpenAI caches automatically); the original
entry thesis goes in the user message as the dynamic part each call.
Add tests mocking the OpenAI response.
```

---

## Step 8 — LangGraph Orchestrator

**Wire everything together with a state machine.**

```
I'm building a LangGraph multi-agent trading system.
This is STEP 8 (FINAL): the LangGraph orchestrator that wires all 7 agents.

Context:
- All 7 agents exist in strategy/agents/
- LangGraph is installed
- Each agent has a run(state: dict) -> dict interface

Task:
Create strategy/orchestrator.py

The orchestrator must:
1. Define a TradingState TypedDict with keys for each agent's output
2. Build a LangGraph StateGraph with nodes:
   fetch_data → qa_check → [circuit_break END | signal_select]
   → risk_alloc → policy_critic → execution → position_manage → END
3. The qa_check node uses conditional_edge:
   if circuit_break=True → END (log and skip cycle)
   else → signal_select
4. Run on a 15-minute APScheduler job (already in requirements)
5. Each cycle logs start/end time and agent count to logger

Also create strategy/agents/agent_runner.py — a CLI entrypoint:
  python -m strategy.agents.agent_runner --symbols SPY,AAPL,NVDA --dry-run

In dry-run mode: run all agents but skip execution_agent.
Add --symbols flag that overrides DEFAULT_STRATEGIES watchlist from config.

Update backend/src/routes/ to add:
  GET /api/agent/status → last cycle timestamp, symbols processed, any vetoes
  GET /api/agent/cycles?limit=20 → recent agent_cycles from DB
  POST /api/agent/run → manually trigger one cycle (dev/debug use)
```

---

## Step 9 — Frontend Agent Log Panel

**Show agent decisions in the dashboard.**

```
I'm adding an Agent Decision Log panel to an existing React trading dashboard.

Context:
- Frontend is React + TypeScript + TailwindCSS at frontend/src/
- Dashboard.tsx exists and already has a bottom tab bar:
  ["positions", "orders", "activity"] tabs
- Backend now has GET /api/agent/cycles and WebSocket event "agent_decision"
- api/client.ts handles all REST calls
- lib/socket.ts handles WebSocket

Task:
Add "agent" as a 4th tab to the bottom tab bar in Dashboard.tsx.

The agent tab must show a table of recent agent cycles:
Columns: Time | Symbol | Signal | Confidence | Risk % | Verdict | Executed

Each row is expandable: clicking shows the full agent reasoning chain
(signal reasoning, risk reasoning, policy veto reasons if any).

Color coding:
- Verdict APPROVED + executed = green
- Verdict VETOED = red with veto reason shown inline
- Verdict APPROVED_WITH_CAUTION = yellow

Add a "Trigger Cycle" button (calls POST /api/agent/run) visible only
in development mode (check import.meta.env.DEV).

Listen to "agent_decision" WebSocket event and prepend new cycles
to the table in real time (same pattern as "signal_fired" in the
existing activity tab).

Keep styling consistent with the existing dark theme (#0d1117 bg,
border-border, text-gain/text-loss for colors).
```

---

## Step 10 - Vector Memory (pgvector) for Steps 2b/3/5

**Use this after Steps 1-9 are stable.**

```
I am extending my existing LangGraph trading bot with vector memory for retrieval-augmented decisions.

Repo context:
- Root: c:\works\vibe_bot
- Python agents in strategy/agents/
- PostgreSQL schema in db/init.sql
- Existing agents: news_analysis_agent.py (Step 2b), signal_selection_agent.py (Step 3)
- Step 5 policy_critic_agent.py may already exist or needs creation
- Config loader: strategy/config.py
- DB driver available: psycopg2-binary
- OpenAI SDK already used for chat completions

Goal:
Add pgvector-based memory so Step 2b/3/5 can write and retrieve historical context.

Requirements:

1) Database schema
- Update db/init.sql:
  - CREATE EXTENSION IF NOT EXISTS vector;
  - Create table agent_memory with columns:
    id BIGSERIAL PK,
    created_at TIMESTAMPTZ default now,
    event_at TIMESTAMPTZ default now,
    symbol VARCHAR(16) null,
    stage VARCHAR(32) not null,
    memory_type VARCHAR(32) not null,
    source_agent VARCHAR(64) not null,
    run_id UUID null,
    cycle_id BIGINT null,
    content_text TEXT not null,
    embedding_model VARCHAR(64) default 'text-embedding-3-small',
    embedding_dim INT default 1536,
    embedding vector(1536) not null,
    confidence REAL null,
    sentiment_score REAL null,
    quality_score REAL null,
    outcome_pnl_pct REAL null,
    metadata_json JSONB default '{}'::jsonb
  - Add indexes for symbol/stage/type/event_at and metadata_json GIN.
  - Add ivfflat cosine index for embedding.

2) Config additions
- Update strategy/config.py Config dataclass and load_config():
  - embedding_model (default: text-embedding-3-small)
  - vector_top_k (default: 6)
  - vector_min_similarity (default: 0.72)

3) New memory module
- Create strategy/memory/vector_memory.py with a small service class:
  - embed_text(text: str) -> list[float]
  - add_memory(...)
  - search_memories(query_text, symbol=None, stages=None, memory_types=None, top_k=None)
- Use OpenAI embeddings API (text-embedding-3-small by default).
- Use psycopg2 connection from config env values.
- Handle failures safely: log errors and return empty results (do not break trading cycle).

4) Integrate Step 2b (news_analysis_agent.py)
- Before LLM call per symbol:
  - Retrieve top 3 similar news_sentiment memories for that symbol (last 90 days).
  - Add compact "historical context" lines to user prompt.
- After successful sentiment parse (or neutral fallback):
  - Write memory row:
    stage='news_analysis', memory_type='news_sentiment', source_agent='NewsAnalysisAgent'.
  - content_text includes headline summary + themes + risks + generated summary.
  - Store confidence/sentiment_score and article metadata in metadata_json.

5) Integrate Step 3 (signal_selection_agent.py)
- Before LLM call:
  - Build retrieval query from current indicators + strategy evidence + news sentiment.
  - Retrieve top 5 memories for same symbol across memory_type in
    ['signal_decision','trade_outcome','news_sentiment'].
  - Add "similar historical setups" section to user prompt.
- After parsed result:
  - Write memory row:
    stage='signal_selection', memory_type='signal_decision', source_agent='SignalSelectionAgent'.
  - Store direction/confidence/reasoning/supporting/conflicting in content_text + metadata_json.

6) Integrate Step 5 (policy_critic_agent.py)
- If file does not exist, create it according to Step 5 spec first.
- Before policy LLM call:
  - Retrieve top 5 risk-relevant memories (policy_review, trade_outcome, signal_decision).
  - Bias retrieval toward prior vetoes and negative outcomes.
  - Inject these into prompt as "risk precedents".
- After verdict:
  - Write memory row:
    stage='policy_critic', memory_type='policy_review', source_agent='PolicyCriticAgent'.
  - Save veto/caution reasons and confidence_adjustment.

7) Tests
- Add/update tests with mocked embedding + DB calls:
  - strategy/tests/test_news_analysis_agent.py
  - strategy/tests/test_signal_selection_agent.py
  - strategy/tests/test_policy_critic_agent.py (if Step 5 exists)
- Validate:
  - Retrieval failures do not crash agents.
  - Prompts include retrieved context when available.
  - Memory writes happen for success and fallback paths.

8) Output and constraints
- Keep existing run(state)->dict contracts unchanged.
- Do not hard fail cycle on vector DB or embedding errors.
- Keep code style consistent with existing project.

Deliverables:
- List all changed files.
- Provide key code excerpts for new module and each agent integration point.
- Provide SQL migration snippet.
- Provide test command(s) and expected pass status.
```
