# Scanner Validation System

Historical replay and forward-return measurement for both Waterfall and Momentum scanners.

---

## Purpose

Validates whether the scanner's stage funnel actually selects stocks that outperform. Replays historical bar data as-of a specific date (no look-ahead), optionally runs the LLM stages, then measures how those picks performed in the N trading days (or N minutes) that followed.

---

## Architecture

```
Frontend (Scanner.tsx)
  └── POST /api/scanner/validate        ← Waterfall
  └── POST /api/momentum/validate       ← Momentum
         │
         ▼  (Redis queue, 15 s poll)
Python worker (main.py)
  ├── poll_waterfall_validate_requests()
  │     └── WaterfallValidator.validate()
  └── poll_momentum_validate_requests()
        └── MomentumValidator.validate()
         │
         ▼  (Redis results)
Frontend reads /api/scanner/validate/results
             /api/momentum/validate/results
```

---

## Redis Keys

| Key | Purpose |
|---|---|
| `scanner:validate_request`  | Queued waterfall validation params |
| `scanner:validate_status`   | Current status (queued / running / ok / error) |
| `scanner:validate_results`  | Full validation result JSON |
| `momentum:validate_request` | Queued momentum validation params |
| `momentum:validate_status`  | Current status |
| `momentum:validate_results` | Full validation result JSON |

---

## Waterfall Validator (`strategy/scanner/waterfall_validator.py`)

### Stage 1 — Indicator screen (always run, free)
Replays `MarketScreener` logic on historical 15-minute bars ending at `21:00 UTC` on the validation date.

Scoring (max 7 pts):
- RSI extreme (`< 35` or `> 65`) → +2
- EMA(9) crossed EMA(21) within last 3 bars → +2
- 5-bar momentum `> 1.5%` → +1
- Price within 1 ATR of VWAP → +1

Pre-filters: price `$5–$2000`, avg 15-min bar volume `≥ 500k`.

### Stage 2 — Deep screen (always run, free)
Replays `DeepScreener` logic on historical 15-minute bars (limit 100).

Scoring (max 6 pts):
- Bollinger Band width `< 4%` (squeeze) → +2
- Current bar volume `> 2× 20-bar avg` (surge) → +2
- 5-bar return beats SPY → +1
- Price above EMA(50) → +1

### Stage 3 — News fetch (optional, free)
Calls `NewsFetcherAgent.fetch()` with `start_iso = date-1d`, `end_iso = date`, pulling Alpaca news archive for the 24h window.

### Stage 4 — News analysis LLM (optional, ~$0.01)
Runs `NewsAnalysisAgent` on the historical news snapshots. Produces sentiment score (-1 to +1), summary, themes per symbol.

### Stage 5 — Signal selection LLM (optional, ~$0.01–0.03)
Runs `SignalSelectionAgent` with a minimal market snapshot built from stage 1/2 data (RSI, EMA, VWAP, signals). Produces BUY / SELL / NO_TRADE + confidence + reasoning.

### Forward Returns
- Reference price = daily close on validation date
- Fetches next N+5 daily bars starting from validation date + 1 day
- `forward_1d`: bars[0] close vs reference
- `forward_3d`: bars[2] close vs reference
- `forward_5d`: bars[4] close vs reference
- Benchmark: average 3-day return of 15 randomly sampled universe symbols

### Output Fields

```json
{
  "status": "ok",
  "scanner_type": "waterfall",
  "validation_date": "2024-01-15",
  "forward_days": 3,
  "stages_run": { "stage3_news": true, "stage4_llm": false, "stage5_llm": false },
  "universe_size": 110,
  "summary": {
    "n_universe": 110,
    "n_stage1": 22,
    "n_stage1_top": 20,
    "n_stage2": 20,
    "n_final": 10,
    "win_rate_1d": 0.6,
    "win_rate_3d": 0.7,
    "win_rate_5d": 0.8,
    "avg_return_1d": 0.82,
    "avg_return_3d": 1.45,
    "avg_return_5d": 2.10,
    "benchmark_avg_return_3d": 0.31
  },
  "ranked": [
    {
      "symbol": "AAPL",
      "combined_score": 9.0,
      "signal": { "direction": "BUY", "confidence": 0.78 },
      "forward_1d": 1.2,
      "forward_3d": 2.3,
      "forward_5d": 3.1
    }
  ],
  "funnel": [
    { "stage": "Universe", "count": 110 },
    { "stage": "Stage 1 — any signal", "count": 22 },
    { "stage": "Stage 1 top 20", "count": 20 },
    { "stage": "Stage 2 — deep scored", "count": 20 },
    { "stage": "Stage 2 top 10", "count": 10 },
    { "stage": "Has news", "count": 8 },
    { "stage": "Signal (BUY/SELL)", "count": 4 }
  ]
}
```

---

## Momentum Validator (`strategy/scanner/momentum_validator.py`)

### Important Constraint
The live Momentum scanner uses the Alpaca snapshots API (live-only). Historical validation reconstructs movers from **daily OHLCV bars** instead.

### Stage 1 — Historical movers (always run, free)
Uses `get_bars(symbol, "1Day", limit=13, end=validation_date)` for every symbol in the curated volatile universe (`_VOLATILE_UNIVERSE`, ~50 symbols).

Hard gates (all must pass):
- `change_pct = (close[-1] - close[-2]) / close[-2] * 100 ≥ 5%`
- `rvol = today_volume / avg_10day_volume ≥ 3×`
- Price `$1–$100`
- Volume `≥ 500k`

Scoring: `0.4 × change_norm + 0.4 × rvol_norm + 0.2 × quality_bonus` (same as live screener).

### Stage 2 — Quality screen (always run, free)
Uses `get_bars(symbol, "1Min", limit=60, start=market_open, end=market_close)` for the validation date.

Market open = `14:30 UTC` (9:30 AM ET).

Scoring (max 6 pts):
- HOD hold: price within 20% of day's high → +1
- Flag / tight consolidation: last 5 bars range tightens to ≤50% of first bar's range → +2
- VWAP reclaim: price was below VWAP and crossed back above → +2

### Stage 3 — News fetch (optional, free)
4-hour lookback window: `start_iso = date 21:00 UTC - 4h`, `end_iso = date 21:00 UTC`.

### Stage 4 — Catalyst LLM (optional, ~$0.01)
Runs `CatalystClassifierAgent`. Produces `catalyst_type`, `catalyst_quality`, `reasoning`.

### Stage 5 — Signal LLM (optional, ~$0.01–0.03)
Runs `MomentumSignalAgent`. Produces BUY/SELL/NO_TRADE + entry zone + T1/T2 targets + stop + hold minutes.

### Forward Returns (intraday)
Entry price = first 1-minute bar close after market open on the validation date.

- `forward_30m`: bars[29] close vs entry
- `forward_60m`: bars[59] close vs entry
- `forward_eod`: last 1-min bar close vs entry
- `forward_1d`: next trading day daily close vs entry

### Output Fields

```json
{
  "status": "ok",
  "scanner_type": "momentum",
  "validation_date": "2024-01-15",
  "summary": {
    "n_universe": 50,
    "n_stage1_pass": 3,
    "n_final": 3,
    "win_rate_30m": 0.67,
    "win_rate_eod": 0.67,
    "avg_return_30m": 1.4,
    "avg_return_eod": 2.1
  },
  "ranked": [
    {
      "symbol": "NVDA",
      "change_pct": 8.3,
      "rvol": 4.2,
      "hod_hold": true,
      "flag_pattern": true,
      "vwap_reclaim": false,
      "signal": { "direction": "BUY", "confidence": 0.82 },
      "forward_30m": 1.8,
      "forward_60m": 2.1,
      "forward_eod": 3.4,
      "forward_1d": -0.5
    }
  ]
}
```

---

## Backend Routes

Registered in `backend/src/index.js`:
```
app.use("/api/scanner",  authMiddleware, waterfallValidateRouter);
app.use("/api/momentum", authMiddleware, momentumValidateRouter);
```

Source: `backend/src/routes/scanner_validate.js`

### Waterfall endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/api/scanner/validate` | Queue waterfall replay |
| GET  | `/api/scanner/validate/status` | Poll status |
| GET  | `/api/scanner/validate/results` | Fetch results |

**POST body:**
```json
{
  "date": "2024-01-15",
  "forward_days": 3,
  "universe": "default",
  "stage1_top_n": 20,
  "stage2_top_n": 10,
  "include_stage3": true,
  "include_stage4": false,
  "include_stage5": false
}
```

### Momentum endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/api/momentum/validate` | Queue momentum replay |
| GET  | `/api/momentum/validate/status` | Poll status |
| GET  | `/api/momentum/validate/results` | Fetch results |

**POST body:**
```json
{
  "date": "2024-01-15",
  "stage1_top_n": 20,
  "stage2_top_n": 10,
  "include_stage3": true,
  "include_stage4": false,
  "include_stage5": false
}
```

---

## Frontend UI (`frontend/src/pages/Scanner.tsx`)

### Waterfall tab
New **"Validate ▸"** button in the header (next to "Pipeline ▸"). When active:
- Replaces the results area with `WaterfallValidationPanel`
- Config: date picker, forward period (1d/3d/5d), universe, stage 1/2 top-N, stage checkboxes
- Stage 4/5 labeled with `($$)` cost warning
- Results: 6 stat cards (picks, win rate 1d/3d, avg return 1d/3d, benchmark), funnel row, picks table with 1d/3d/5d columns

### Momentum tab
New **"Validate"** sub-tab (alongside "Results" and "Pipeline Logic"):
- Config: date picker, stage 1/2 top-N, stage checkboxes
- Results: 5 stat cards (picks, win rate 30m/EOD, avg return 30m/EOD), funnel row, picks table with +30m/+60m/EOD/+1d columns
- Quality badges per row: `HOD`, `FLAG`, `VWAP`

---

## Caveats

1. **Momentum Stage 1 approximation** — The live scanner uses the Alpaca snapshots API (current-day only). Historical validation uses daily close bars instead, so `change_pct` is close-to-close rather than real-time intraday %.

2. **Market hours sensitivity** — `_open_dt()` uses `14:30 UTC` (9:30 AM ET standard time). During EDT (summer), market open is `13:30 UTC`. Intraday bars fetched with this start may miss the first hour in summer. This is a known limitation.

3. **API data availability** — Alpaca IEX feed may not have 1-minute intraday bars for all historical dates or all symbols, especially smaller-cap volatile names.

4. **News archive** — Alpaca News API supports historical dates. However, very old news (>2 years) may not be available depending on subscription tier.

5. **LLM stages use current prompts** — Stages 4-5 call the same agents with the same prompts as the live scan. If prompts have changed since the validation date, results won't reflect what the system would have produced at that time.

---

## Files Added / Modified

| File | Change |
|---|---|
| `strategy/scanner/waterfall_validator.py` | New — `WaterfallValidator` class |
| `strategy/scanner/momentum_validator.py` | New — `MomentumValidator` class |
| `strategy/main.py` | Added `poll_waterfall_validate_requests()` and `poll_momentum_validate_requests()`, registered at 15s interval |
| `backend/src/routes/scanner_validate.js` | New — 6 routes (3 waterfall, 3 momentum) |
| `backend/src/index.js` | Registered `waterfallValidateRouter` and `momentumValidateRouter` |
| `frontend/src/pages/Scanner.tsx` | Added validation types, `RetCell`, `WaterfallValidationPanel`, `MomentumValidationPanel`, wired into both tabs |
