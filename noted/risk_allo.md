# Risk Allocation Agent (Step 4)

## Purpose

The Risk & Capital Allocation agent converts approved trade direction into an executable, risk-bounded position plan.

It has two responsibilities:

- Enforce deterministic guardrails that are never bypassed.
- Use LLM reasoning only for context-aware sizing/levels inside those hard limits.

This keeps the system adaptive without giving up strict risk control.

---

## Inputs and Outputs

Inputs:

- `signal_selections` (from Step 3)
- `portfolio` snapshot (`equity`, `cash`, `buying_power`, `positions`)
- `market_snapshots` (for latest price and ATR volatility)

Output per symbol:

- `RiskAllocation`
  - `approved`
  - `symbol`
  - `qty`
  - `entry_price`
  - `stop_loss`
  - `profit_target`
  - `risk_pct`
  - `reasoning`
  - `rejection_reason`

The agent writes `risk_allocations` into state.

---

## Hard Rules (Deterministic)

Applied before/after LLM and always override model output:

1. Max position size from config: `MAX_POSITION_SIZE_PCT` (default 5% of equity).
2. If symbol is already held, max add size = 2% of equity.
3. If open positions >= 5, reject new BUY entries.
4. Max single-trade risk = 1.5% of equity, based on `abs(entry - stop_loss) * qty`.

If any hard rule fails, allocation is rejected safely with `approved=false`.

---

## LLM Role

Model: `gpt-4o-mini` via structured output parse.

The model suggests:

- quantity,
- stop-loss,
- profit target,
- risk reasoning,

using context such as signal confidence, portfolio stats, and ATR(14).

System prompt remains constant for prompt caching efficiency.

Important: model output is post-processed by hard caps. If model suggests `qty=80` but hard cap is `50`, final quantity is `50`.

---

## Practical Orchestrator Wiring

Pipeline is now:

- `market_data -> data_qa -> news_fetch -> news_analysis -> signal_selection -> portfolio_snapshot -> risk_allocation -> END`

`portfolio_snapshot` node was added to fetch live portfolio just before Step 4.

Portfolio source:

- `alpaca.get_account()`
- `alpaca.get_positions()`

Normalization:

- numeric fields cast to `float`
- positions normalized to basic dicts (`symbol`, `qty`, prices, PnL)

Failure behavior:

- if portfolio fetch fails, orchestrator logs error and injects zeroed portfolio instead of crashing cycle.

---

## Status Payload Additions

Agent status now includes a compact portfolio summary:

- `portfolio.equity`
- `portfolio.cash`
- `portfolio.buying_power`
- `portfolio.positions_count`

And includes `risk_allocations` for downstream dashboard/API visibility.

---

## Tests Added

`strategy/tests/test_risk_agent.py`

- rejects `NO_TRADE`
- rejects BUY when open positions limit hit
- enforces max position cap
- enforces max add cap for existing position
- enforces 1.5% single-trade risk cap
- handles OpenAI failure safely

`strategy/tests/test_orchestrator_portfolio_snapshot.py`

- verifies portfolio snapshot normalization from Alpaca objects
- verifies zeroed fallback on portfolio fetch error
- verifies status payload includes portfolio summary fields
