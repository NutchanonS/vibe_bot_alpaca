# Vector DB in Vibe Bot: Purpose and Logic

## Why we add a Vector DB

The trading pipeline already has strong "current-cycle" reasoning (market data, QA, news sentiment, signal decision, policy review). A vector database adds **memory across cycles**.

Main purpose:

- Keep reusable memory from past decisions and outcomes.
- Retrieve similar historical situations for the current symbol.
- Improve consistency in Step 2b (NewsAnalysis), Step 3 (SignalSelection), and Step 5 (PolicyCritic).
- Reduce one-off, short-memory decisions from LLM calls.

In short: the Vector DB is not replacing indicators or hard risk rules. It gives the agents long-term context.

---

## What is stored

Each memory record stores:

- **content_text**: compact textual summary (news themes, signal reasoning, veto reasons, outcome notes).
- **embedding**: numeric vector of that text (for similarity search).
- **metadata**: symbol, stage, memory type, timestamp, confidence, sentiment, optional PnL/outcome.

Recommended memory types:

- `news_sentiment` (from Step 2b)
- `signal_decision` (from Step 3)
- `policy_review` (from Step 5)
- `trade_outcome` (written when result becomes known)

---

## End-to-end logic

1. Agent creates a compact text summary of what happened.
2. System generates embedding (for example `text-embedding-3-small`).
3. Row is inserted into `agent_memory` with metadata.
4. In a future cycle, an agent builds a query text for "what is happening now".
5. Query text is embedded.
6. Vector similarity search returns top-k nearest memories.
7. Agent injects these memories into its LLM prompt as context.
8. Agent writes new memory after decision, closing the loop.

This forms a retrieval-augmented feedback system.

---

## Step-specific integration

## Step 2b: NewsAnalysisAgent

Purpose in this step:

- Avoid overreacting to single headlines.
- Compare current news to historically similar news clusters.

Logic:

- Before sentiment LLM call, retrieve top similar `news_sentiment` memories for the same symbol.
- Add short "historical context" lines to prompt.
- After result (or neutral fallback), write a new `news_sentiment` memory.

## Step 3: SignalSelectionAgent

Purpose in this step:

- Ground signal direction with what worked/failed in similar setups.

Logic:

- Build retrieval query from indicators + strategy evidence + news sentiment.
- Retrieve top similar memories across `signal_decision`, `trade_outcome`, `news_sentiment`.
- Add "similar historical setups" block in prompt.
- After parsed decision, write `signal_decision` memory.

## Step 5: PolicyCriticAgent

Purpose in this step:

- Improve veto quality and risk skepticism with precedent.

Logic:

- Retrieve risk-heavy precedents (`policy_review`, negative `trade_outcome`, prior vetoes).
- Inject as "risk precedents" in policy prompt.
- Write `policy_review` memory with verdict and reasons.

---

## Safety and reliability rules

- Vector retrieval is **advisory context only**; hard deterministic risk rules still win.
- If embedding API or DB search fails, agent continues with empty context.
- Never block the trading cycle because memory retrieval failed.
- Use timestamps and confidence filters to avoid stale/noisy memories.

---

## What makes this useful

Expected gains:

- Better consistency across cycles.
- Fewer contradictory decisions for similar conditions.
- Better policy veto explanations with historical evidence.
- Faster operator debugging ("show me similar past cycles").

Limits:

- Early on, memory quality is low (not enough history).
- Good results depend on writing clean, compact, high-signal memory text.
- Outcome-linked memories (`trade_outcome`) are critical for real learning.

---

## Minimal operational checklist

- Enable `pgvector` in Postgres.
- Create `agent_memory` table + indexes.
- Add embedding config in `strategy/config.py`.
- Add memory service module (`strategy/memory/vector_memory.py`).
- Integrate read/write in Steps 2b, 3, and 5.
- Add tests for fallback behavior (no crash on vector/embedding failure).

If these are done, the system moves from one-cycle reasoning to memory-augmented reasoning.
