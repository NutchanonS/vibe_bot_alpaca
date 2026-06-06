# Market Scanner — Waterfall Design & Logic

## Overview

The scanner finds high-potential trading candidates from a broad universe using a
waterfall funnel: each stage is cheaper than the next, so expensive LLM calls are
only paid for the small set of symbols that survive fast free filters.

```
Universe (~110 symbols)
        │
        ▼ ─────────────────────────────────────────────────────────────────────
 Stage 1 │ INDICATOR SCAN           free — Alpaca bar API only
──────── │   RSI extreme · EMA crossover · 5-bar momentum · VWAP proximity
         │   Pre-filter: volume ≥500k, price $5–$2000
         │   Time: ~60–90s (110 bar fetches)   Cost: $0
         ↓ top stage1_top_n (default 20)
─────────────────────────────────────────────────────────────────────────────
 Stage 2 │ DEEP CONFIRMATION SCAN   free — same bar data, longer lookback
──────── │   Bollinger Band squeeze  (upper−lower)/mid < 4%       → +2 pts
         │   Volume surge            current vol > 2× 20-bar avg  → +2 pts
         │   Relative strength       5-bar return > SPY 5-bar     → +1 pt
         │   Trend alignment         price vs EMA(50)             → +1 pt
         │   SPY fetched once, compared against all stage1 survivors
         │   Time: ~10–20s (20 bar fetches + 1 SPY)   Cost: $0
         ↓ top stage2_top_n (default 10) by combined_score = stage1 + stage2
─────────────────────────────────────────────────────────────────────────────
 Stage 3 │ NEWS FETCH               free — Alpaca News API
──────── │   Batch request for all stage2 survivors in one API call
         │   Returns articles from last 24h per symbol
         │   Time: ~2s   Cost: $0
         ↓ 10 symbols + articles
─────────────────────────────────────────────────────────────────────────────
 Stage 4 │ NEWS ANALYSIS            LLM × ~10 calls
──────── │   NewsAnalysisAgent (existing, unchanged)
         │   gpt-4o-mini structured output → NewsSentiment per symbol
         │   Outputs: sentiment score, confidence, themes, bullish/bearish reasons
         │   Time: ~5–15s   Cost: ~$0.01 total
         ↓ 10 symbols with sentiment
─────────────────────────────────────────────────────────────────────────────
 Stage 5 │ SIGNAL SELECTION         LLM × ~10 calls
──────── │   SignalSelectionAgent (existing, unchanged)
         │   gpt-4o-mini → direction + confidence + reasoning
         │   Confidence gate: direction forced NO_TRADE if confidence < 0.65
         │   Time: ~10–20s   Cost: ~$0.01 total
         ↓ 10 symbols with direction/confidence
─────────────────────────────────────────────────────────────────────────────
 Stage 6 │ RISK ALLOCATION          LLM × ~10 calls (approved signals only)
──────── │   RiskCapitalAllocationAgent (existing, unchanged)
         │   gpt-4o-mini + hard guardrails → qty, stop_loss, profit_target
         │   Hard rules always override LLM output
         │   Time: ~10–20s   Cost: ~$0.01 total
         ↓
─────────────────────────────────────────────────────────────────────────────
 OUTPUT  │ RANKED TABLE
         │   Sort: actionable first → confidence desc → combined_score desc
         │   Per row: Symbol · Score (S1+S2) · Flags · Direction · Conf ·
         │            Entry · Stop · R:R · expandable detail
```

### LLM cost comparison

| Approach                          | LLM calls | Est. cost/scan |
|-----------------------------------|-----------|----------------|
| All agents on full universe       | 110×3     | ~$0.50+        |
| Current scanner (no waterfall)    | 10×3      | ~$0.03         |
| **Waterfall (this design)**       | **10×3**  | **~$0.03**     |

The funnel is cost-equivalent to the old scanner at the default top-10 setting,
but it sends *better* candidates into the LLM phases because Stage 2 confirms
conviction before spending any LLM budget.

---

## Stage 1: Indicator Scan

File: `strategy/scanner/screener.py` — class `MarketScreener`

### Pre-filter (hard gates — symbol skipped if either fails)

| Gate | Threshold |
|---|---|
| Average bar volume | ≥ 500,000 shares |
| Latest price | $5.00 – $2,000.00 |

### Scoring rubric (max 7 pts)

| Signal | Points | Condition |
|---|---|---|
| RSI extreme | +2 | RSI(14) < 35 (oversold) OR > 65 (overbought) |
| EMA crossover | +2 | EMA(9) crossed EMA(21) within last 3 bars |
| 5-bar momentum | +1 | `|(close[-1] − close[-6]) / close[-6]| > 1.5%` |
| VWAP proximity | +1 | `|price − VWAP| ≤ ATR(14)` |
| News bonus | +1 | Symbol appears in news (passed in from caller) |

Symbols sorted by score desc, top `stage1_top_n` survive.

### Indicator implementation

All self-contained inside `screener.py` (no dependency on `indicators/`):

- **RSI(14)**: Wilder's RS using rolling mean of gains/losses.
- **EMA(9/21)**: `pandas.ewm(span=N, adjust=False)`.
- **VWAP**: Cumulative `(typical × vol) / cumulative_vol` over the bar window.
- **ATR(14)**: `max(H−L, |H−prev_close|, |L−prev_close|)` 14-period rolling mean.

---

## Stage 2: Deep Confirmation Scan

File: `strategy/scanner/deep_screener.py` — class `DeepScreener`

Runs on Stage 1 survivors only (~20 symbols). Fetches SPY once for relative-strength baseline.

### Scoring rubric (max 6 pts)

| Signal | Points | Condition |
|---|---|---|
| Bollinger Band squeeze | +2 | `(upper − lower) / mid < 4%` — bands contracting, breakout pending |
| Volume surge | +2 | Current bar volume > 2× 20-bar average — institutional activity |
| Relative strength vs SPY | +1 | 5-bar return > SPY 5-bar return — alpha not beta |
| Trend alignment | +1 | Price above EMA(50) for bullish candidates, below for bearish |

**Combined score** = Stage 1 score + Stage 2 score (max 13).
Symbols sorted by combined score desc, top `stage2_top_n` survive.

### Trend alignment logic

Direction is inferred from Stage 1 signals (no LLM needed):
- Signal contains "oversold" or "bullish" or "up" → expect BUY → check `price > EMA(50)`
- Signal contains "overbought" or "bearish" → expect SELL → check `price < EMA(50)`
- Ambiguous → `trend_aligned = None`, no points awarded

### Fallback behaviour

If bar fetch fails for a symbol, it carries its Stage 1 score with `deep_score = 0`
so it is never silently dropped from the funnel.

---

## Stages 3–6: Agent Pipeline

File: `strategy/scanner/scan_pipeline.py` — class `WaterfallScanPipeline`

Stage 2 survivors are passed as `symbols` to the existing `AgentOrchestrator.run()`.
The orchestrator runs the full internal chain:

```
MarketDataFetcherAgent → DataQAAgent → NewsFetcherAgent
  → NewsAnalysisAgent → SignalSelectionAgent → portfolio_snapshot → RiskCapitalAllocationAgent
```

The scan uses `trigger="scanner"` so it can be distinguished from scheduled or manual runs.

No changes to any agent. The waterfall only controls which symbols enter.

---

## Ranked Output

Each row in `ranked[]`:

| Field | Source | Notes |
|---|---|---|
| `symbol` | Stages 1+2 | |
| `stage1_score` | Stage 1 | 0–7 |
| `deep_score` | Stage 2 | 0–6 |
| `combined_score` | Computed | stage1 + deep |
| `screener_signals` | Stage 1 | List of triggered rules |
| `deep_signals` | Stage 2 | List of triggered rules |
| `bb_squeeze` | Stage 2 | bool |
| `volume_surge` | Stage 2 | bool |
| `relative_strength_vs_spy` | Stage 2 | float, positive = outperforming |
| `trend_aligned` | Stage 2 | bool or null |
| `direction` | SignalSelectionAgent | BUY / SELL / NO_TRADE |
| `confidence` | SignalSelectionAgent | 0.0–1.0 |
| `reasoning` | SignalSelectionAgent | LLM explanation |
| `risk_approved` | RiskCapitalAllocationAgent | bool |
| `qty` / `entry_price` / `stop_loss` / `profit_target` / `risk_pct` | Risk agent | |
| `rr_ratio` | Computed | `|target − entry| / |entry − stop|` |
| `rejection_reason` | Risk agent | Set if not approved |

### Sort order

1. Actionable (`direction ≠ NO_TRADE`) first
2. Then by `confidence` descending
3. Then by `combined_score` descending

---

## Trigger Flow

```
User clicks "Run Scan"
  → POST /api/scanner/run  {stage1_top_n, stage2_top_n, universe}
  → Backend writes "scanner:run_request" to Redis (TTL 300s)
  → Backend writes "scanner:status" = {status: "queued"}

Python main.py polls "scanner:run_request" every 15s
  → Deletes key (deduplication)
  → Writes "scanner:status" = {status: "running"}
  → Calls WaterfallScanPipeline.run(universe_name, stage1_top_n, stage2_top_n)
  → Writes "scanner:results" to Redis (TTL 3600s)
  → Writes "scanner:status" = {status: "ok", stage1_count, stage2_count, candidates_found}

Frontend polls:
  GET /api/scanner/status  every 5s   → funnel counts + status bar
  GET /api/scanner/results every 10s  → ranked table
```

---

## Two Parallel Flows — Scanner vs Specific Stock

These flows share agents but are completely independent:

| | Flow A — Specific stock | Flow B — Waterfall scanner |
|---|---|---|
| Entry point | Agents tab → "Run Now" → symbol picker | Scanner page → "Run Scan" → funnel settings |
| Symbol source | User-selected (1–N symbols) | Universe → Stage 1 → Stage 2 survivors |
| Agent chain | Full 6-agent orchestrator | Same orchestrator, but on screened symbols only |
| Result location | Agents / News Analysis / Signals / Risk tabs | Scanner page ranked table |
| Trigger key | `agent:run_request` | `scanner:run_request` |
| Result key | `agent:status` | `scanner:results` |

Neither flow affects the other.

---

## Files

| File | Purpose |
|---|---|
| `strategy/scanner/__init__.py` | Package init |
| `strategy/scanner/universe.py` | Symbol universe lists (`default`, `tech`, `etfs`) |
| `strategy/scanner/screener.py` | `MarketScreener` — Stage 1 indicator scoring |
| `strategy/scanner/deep_screener.py` | `DeepScreener` — Stage 2 BB/volume/RS/trend scoring |
| `strategy/scanner/scan_pipeline.py` | `WaterfallScanPipeline` — orchestrates all stages |
| `strategy/main.py` | `poll_scanner_run_requests()` + scheduler job (15s) |
| `backend/src/routes/scanner.js` | `POST /run`, `GET /status`, `GET /results` |
| `frontend/src/pages/Scanner.tsx` | Scanner UI — funnel controls + ranked table |
| `frontend/src/App.tsx` | Scanner route `/app/scanner` + sidebar nav |

---

## Rate Limiting Notes

Stage 1 fetches 15-min bars for ~110 symbols sequentially.
Stage 2 fetches 100-bar history for ~20 survivors + 1 SPY fetch.
Total: ~131 Alpaca data API calls per scan.
Alpaca allows 200 requests/min — well within limits.
Symbols that timeout or return no data are silently skipped (never crash the pipeline).
