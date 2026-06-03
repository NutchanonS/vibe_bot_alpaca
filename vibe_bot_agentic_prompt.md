# Agentic AI Trading System — Claude Code Prompt Playbook

Reference: https://medium.com/predict/building-an-agentic-ai-trading-system-from-end-to-end-0fbc0a95b2e2

## Architecture Map: Existing → Agentic

```
CURRENT                          AGENTIC UPGRADE
──────────────────────────────────────────────────────────────
alpaca_client.py          →  Agent 1: MarketDataFetcher
(no validation)           →  Agent 2: DataQA + CircuitBreaker
rsi/ema/vwap strategies   →  Agent 3: SignalSelection (LLM)
risk_manager.py           →  Agent 4: RiskCapitalAllocation (LLM)
(none)                    →  Agent 5: PolicySelfCritic (LLM)
order_manager.py          →  Agent 6: ExecutionAgent (deterministic)
(none)                    →  Agent 7: PositionManager (LLM)
(none)                    →  LangGraph: orchestrator loop
backend/routes/           →  New: /api/agent/status + /api/agent/run
frontend/                 →  New: AgentLog panel in Dashboard
```

## Recommended Build Order Summary

| Step | Agent | LLM? | Complexity | Builds On |
|------|-------|-------|------------|-----------|
| 1 | MarketDataFetcher | No | Low | alpaca_client |
| 2 | DataQA + CircuitBreaker | No | Low | Step 1 |
| 3 | SignalSelection | Yes (Claude) | Medium | Steps 1-2 + strategies/ |
| 4 | RiskCapital | Yes (Claude) | Medium | Steps 1-3 + risk_manager |
| 5 | PolicySelfCritic | Yes (Claude) | Medium | Steps 1-4 |
| 6 | Execution | No | Low | Steps 1-5 + order_manager |
| 7 | PositionManager | Yes (Claude) | High | Steps 1-6 + DB |
| 8 | LangGraph Orchestrator | No | High | All agents |
| 9 | Frontend Panel | No | Low | Step 8 |

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

## Step 3 — Signal Selection Agent (First LLM Agent)

**Build third because:** this is the first Claude/GPT call. Builds on existing strategy signals as "evidence" for the LLM to reason over.

```
I'm building a LangGraph multi-agent trading system.
This is STEP 3 of 7: the SignalSelection agent — the first LLM-powered agent.

Context:
- strategy/agents/base_agent.py, market_data_agent.py, data_qa_agent.py exist
- strategy/strategies/ has RSI, EMA, VWAP rule-based strategies
- strategy/indicators/ has RSI, EMA, VWAP, Bollinger implementations
- Add anthropic SDK to requirements.txt (use claude-sonnet-4-6)

Task:
Create strategy/agents/signal_selection_agent.py

The agent must:
1. Accept a list of approved MarketSnapshot objects (from QA agent)
2. For each symbol, run ALL existing rule-based strategies
   (RSI, EMA, VWAP) to get their Signal objects — use these as EVIDENCE
3. Build a structured prompt that includes:
   - Current price, RSI value, EMA(9) vs EMA(21), VWAP relationship
   - All strategy signals with their strength scores
   - 5-bar price momentum summary
4. Call Claude claude-sonnet-4-6 with tool_use structured output.
   The output schema (use Pydantic):
     symbol: str
     direction: Literal["BUY", "SELL", "NO_TRADE"]
     confidence: float  # 0.0-1.0
     reasoning: str     # 2-3 sentences max
     supporting_signals: list[str]  # which strategies agreed
     conflicting_signals: list[str] # which strategies disagreed
5. IMPORTANT: Agent must output NO_TRADE if confidence < 0.65
6. Enable prompt caching on the system prompt (use cache_control)

Store API key via ANTHROPIC_API_KEY in .env and strategy/config.py.
Add tests mocking the Claude response.
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
3. If passes hard rules, call Claude claude-sonnet-4-6 to reason about:
   - Suggested position size given confidence score and volatility (use ATR from bars)
   - Whether current market conditions warrant reduced sizing
   - Stop-loss price and profit target price
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
Use prompt caching for system prompt.
Add tests.
```

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
2. Call Claude claude-sonnet-4-6 with a DIFFERENT system prompt than the
   Signal agent — this agent's persona is a risk-averse compliance officer
   whose job is to find reasons NOT to trade.
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

Use prompt caching. The system prompt for this agent should be separated
from the signal agent's system prompt (different cache block).
Add tests.
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
4. Call Claude claude-sonnet-4-6 and ask: given the ORIGINAL reasoning
   and CURRENT price/indicators, should we:
   - HOLD (thesis intact)
   - EXIT (thesis broken, price action contradicts entry reasoning)
   - TRAIL_STOP (move stop-loss up to lock in gains)
5. If current unrealized P&L > 2x original risk_pct: force TRAIL_STOP
   (deterministic override regardless of LLM output)
6. If position age > 3 trading days with no profit: force EXIT
   (deterministic override)
7. Return list[PositionDecision]:
     symbol, action, new_stop_price, exit_reason, reasoning

Use prompt caching. The original entry thesis is the dynamic part of the
prompt; the system instructions are the cached part.
Add tests.
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
