# Backtest Logic

## Overview

The backtest system is fully server-side in Node.js ([backend/src/routes/backtest.js](../backend/src/routes/backtest.js)).
It fetches real historical OHLCV bars from Alpaca, replays each strategy's entry/exit rules bar-by-bar,
and returns trades + performance stats. There is no Python involvement — the strategy simulators are
reimplemented in JavaScript independently of the live Python strategy engine.

The frontend entry point is the **Strategies > Backtest Monitor** tab ([frontend/src/pages/Strategies.tsx](../frontend/src/pages/Strategies.tsx#L992)).

---

## API Endpoint

```
GET /api/backtest
```

### Query Parameters

| Parameter   | Type   | Default              | Description |
|-------------|--------|----------------------|-------------|
| `symbol`    | string | `SPY`                | Single symbol to test |
| `symbols`   | string | —                    | Comma-separated list (overrides `symbol`); runs all in parallel |
| `strategy`  | string | `all`                | `all` \| `rsi_mean_reversion` \| `ema_crossover` \| `vwap_breakout` |
| `timeframe` | string | `3m`                 | `1m` (60d) \| `3m` (120d) \| `6m` (210d) \| `1y` (400d) |
| `params`    | JSON   | strategy defaults    | JSON override for strategy parameters (e.g. `{"rsi_period":20}`) |

### Example

```
GET /api/backtest?symbols=SPY,AAPL,TSLA&strategy=all&timeframe=6m
```

---

## Input: Bar Fetching

Bars are fetched from Alpaca's market data API:

```
GET https://data.alpaca.markets/v2/stocks/{symbol}/bars
  ?timeframe=1Day
  &start={N days ago}
  &limit=10000
  &adjustment=raw
  &feed=iex
  &sort=asc
```

**Always uses daily bars regardless of timeframe parameter.** The `timeframe` parameter only controls
*how many days back* to fetch, not the bar resolution. All three strategies run on daily OHLCV data.

Each bar is normalized to: `{ time, open, high, low, close, volume }`.

---

## Strategy Simulators

All three simulators follow the same execution model:

> **Signal fires at bar `i` → entry/exit fills at `bars[i+1].open` (next bar's open)**

This avoids look-ahead bias on the signal bar.

### 1. RSI Mean Reversion (`simRSI`)

**Default params:** `rsi_period=14`, `oversold=30`, `overbought=70`

| Event | Condition | Action |
|-------|-----------|--------|
| Entry | `RSI[i] < oversold` and no open position | Buy at `bars[i+1].open` |
| Exit  | `RSI[i] > overbought` | Sell at `bars[i+1].open` |

One position at a time. Signals are only evaluated from bar index `rsi_period` onward.

### 2. EMA Crossover (`simEMA`)

**Default params:** `fast_period=9`, `slow_period=21`, `volume_multiplier=1.2`

| Event | Condition | Action |
|-------|-----------|--------|
| Entry | EMA(fast) crosses above EMA(slow) **and** current volume > rolling avg × `volume_multiplier` | Buy at `bars[i+1].open` |
| Exit  | EMA(fast) crosses below EMA(slow) | Sell at `bars[i+1].open` |

Rolling average volume uses up to last 20 bars. Signals evaluated from `slow_period` onward.

### 3. VWAP Breakout (`simVWAP`)

**Default params:** `volume_zscore_threshold=1.5`, `lookback_volume=20`

VWAP is computed as a **rolling window** (not session-reset), using the last `lookback_volume` bars:

```
VWAP[i] = sum((H+L+C)/3 × V over window) / sum(V over window)
```

| Event | Condition | Action |
|-------|-----------|--------|
| Entry | `close > VWAP` **and** volume z-score > `volume_zscore_threshold` | Buy at `bars[i+1].open` |
| Exit  | `close < VWAP` | Sell at `bars[i+1].open` |

Volume z-score = `(current_volume - mean_volume) / std_volume` over the lookback window.

---

## Open Position Handling

If a position is still open at the end of the bar series (no exit signal fired), it is force-closed
at the last bar's `close` price. These trades are tagged `open: true` in the output and excluded
from performance statistics (`calcStats` filters on `!t.open`).

---

## Output

### Response Structure

```json
{
  "timeframe": "3m",
  "symbols": ["SPY", "AAPL"],
  "data": {
    "SPY": {
      "barCount": 120,
      "results": {
        "rsi_mean_reversion": { "trades": [...], "stats": {...}, "params": {...} },
        "ema_crossover":      { "trades": [...], "stats": {...}, "params": {...} },
        "vwap_breakout":      { "trades": [...], "stats": {...}, "params": {...} }
      }
    },
    "AAPL": { ... }
  }
}
```

### Trade Object

```json
{
  "entryTime":  "2024-03-15",
  "entryPrice": 510.20,
  "exitTime":   "2024-04-02",
  "exitPrice":  523.80,
  "pnlPct":     2.665,
  "open":       false
}
```

`pnlPct` = `(exitPrice - entryPrice) / entryPrice × 100`

### Stats Object

| Field          | Description |
|----------------|-------------|
| `totalTrades`  | Count of closed trades |
| `openTrades`   | Trades still open at end of series |
| `wins`         | Closed trades with `pnlPct > 0` |
| `losses`       | Closed trades with `pnlPct <= 0` |
| `winRate`      | `wins / totalTrades × 100` (%) |
| `totalPnlPct`  | Sum of all closed trade P&L (%) |
| `avgWin`       | Average P&L of winning trades (%) |
| `avgLoss`      | Average P&L of losing trades (%) |
| `profitFactor` | `sum(wins) / abs(sum(losses))`, capped at 99 |
| `curve`        | Array of `{ time, cumPnl }` — cumulative P&L over trade exits |

---

## Frontend Usage

The **BacktestTab** component ([Strategies.tsx:992](../frontend/src/pages/Strategies.tsx#L992)):

1. Hardcodes a fixed symbol list (`COMPARE_SYMS`) for comparison
2. Calls `GET /api/backtest?symbols=...&strategy=...&timeframe=...` via React Query (2-minute stale time)
3. Displays per-strategy performance cards with win rate, total P&L, profit factor
4. Renders a candlestick chart with strategy-specific indicator overlays (EMA lines, RSI, VWAP)
5. Trade entry/exit markers are plotted on the chart as colored flags

The landing page [Backtest.tsx](../frontend/src/components/landing/Backtest.tsx) shows a static demo
equity curve (generated by `genEquityCurve()` in `demoData.ts`) — it is not connected to real data.

---

## Execution Model: Signal → Fill → Return

**File:** [backend/src/routes/backtest.js](../backend/src/routes/backtest.js) — all three simulators live here (`simRSI`, `simEMA`, `simVWAP`).

### How a trade's return is computed

```
Entry:  bars[i+1].open   ← buy here (next bar after signal)
Exit:   bars[j+1].open   ← sell here (next bar after exit signal, j > i)

pnlPct = (exitPrice - entryPrice) / entryPrice × 100
```

The gap between `i` and `j` is unbounded — it can be 1 bar or 200 bars.
There is no fixed holding period; the strategy holds until its exit condition fires.

### Why fill at `bars[i+1].open` and not `bars[i].close`

At bar `i` you observe the close and compute the indicator. That close is already gone — you cannot
trade it. The earliest you can realistically execute is the *next* bar's open. Using `bars[i].close`
as the fill price would be look-ahead bias.

### Exact code for each simulator

**RSI** ([backtest.js:51](../backend/src/routes/backtest.js#L51)):
```js
function simRSI(bars, p = {}) {
  const { rsi_period = 14, oversold = 30, overbought = 70 } = p;
  const closes = bars.map(b => b.close);
  const rsi = calcRSI(closes, rsi_period);
  const trades = [];
  let pos = null;
  for (let i = rsi_period; i < bars.length - 1; i++) {
    if (rsi[i] === null) continue;
    if (!pos && rsi[i] < oversold) {
      pos = { entryTime: bars[i + 1].time, entryPrice: bars[i + 1].open };
    } else if (pos && rsi[i] > overbought) {
      const ep = bars[i + 1].open;
      trades.push({ ...pos, exitTime: bars[i + 1].time, exitPrice: ep,
                    pnlPct: (ep - pos.entryPrice) / pos.entryPrice * 100 });
      pos = null;
    }
  }
  // force-close any open position at last bar's close
  if (pos) {
    const lb = bars[bars.length - 1];
    trades.push({ ...pos, exitTime: lb.time, exitPrice: lb.close,
                  pnlPct: (lb.close - pos.entryPrice) / pos.entryPrice * 100, open: true });
  }
  return trades;
}
```

**EMA** ([backtest.js:74](../backend/src/routes/backtest.js#L74)):
```js
function simEMA(bars, p = {}) {
  const { fast_period = 9, slow_period = 21, volume_multiplier = 1.2 } = p;
  const closes = bars.map(b => b.close);
  const vols   = bars.map(b => b.volume);
  const ef = calcEMA(closes, fast_period);
  const es = calcEMA(closes, slow_period);
  const trades = [];
  let pos = null;
  for (let i = slow_period; i < bars.length - 1; i++) {
    if (ef[i] === null || es[i] === null || ef[i-1] === null || es[i-1] === null) continue;
    const lb    = Math.min(20, i);
    const avgV  = vols.slice(i - lb, i).reduce((a, b) => a + b, 0) / lb;
    const crossUp = ef[i] > es[i] && ef[i-1] <= es[i-1];
    const crossDn = ef[i] < es[i] && ef[i-1] >= es[i-1];
    if (!pos && crossUp && vols[i] > avgV * volume_multiplier) {
      pos = { entryTime: bars[i+1].time, entryPrice: bars[i+1].open };
    } else if (pos && crossDn) {
      const ep = bars[i+1].open;
      trades.push({ ...pos, exitTime: bars[i+1].time, exitPrice: ep,
                    pnlPct: (ep - pos.entryPrice) / pos.entryPrice * 100 });
      pos = null;
    }
  }
  if (pos) {
    const lb = bars[bars.length - 1];
    trades.push({ ...pos, exitTime: lb.time, exitPrice: lb.close,
                  pnlPct: (lb.close - pos.entryPrice) / pos.entryPrice * 100, open: true });
  }
  return trades;
}
```

**VWAP** ([backtest.js:103](../backend/src/routes/backtest.js#L103)):
```js
function simVWAP(bars, p = {}) {
  const { volume_zscore_threshold = 1.5, lookback_volume = 20 } = p;
  const closes = bars.map(b => b.close);
  const vols   = bars.map(b => b.volume);
  // Rolling VWAP using lookback window
  const vwap = bars.map((_, i) => {
    const lb    = Math.min(lookback_volume, i + 1);
    const slice = bars.slice(i - lb + 1, i + 1);
    const tv    = slice.reduce((s, x) => s + (x.high + x.low + x.close) / 3 * x.volume, 0);
    const sv    = slice.reduce((s, x) => s + x.volume, 0);
    return sv > 0 ? tv / sv : null;
  });
  const trades = [];
  let pos = null;
  for (let i = lookback_volume; i < bars.length - 1; i++) {
    if (vwap[i] === null) continue;
    const lb      = Math.min(lookback_volume, i);
    const vs      = vols.slice(i - lb, i);
    const avg     = vs.reduce((a, b) => a + b, 0) / vs.length;
    const std     = Math.sqrt(vs.reduce((s, v) => s + (v - avg) ** 2, 0) / vs.length);
    const zs      = std > 0 ? (vols[i] - avg) / std : 0;
    if (!pos && closes[i] > vwap[i] && zs > volume_zscore_threshold) {
      pos = { entryTime: bars[i+1].time, entryPrice: bars[i+1].open };
    } else if (pos && closes[i] < vwap[i]) {
      const ep = bars[i+1].open;
      trades.push({ ...pos, exitTime: bars[i+1].time, exitPrice: ep,
                    pnlPct: (ep - pos.entryPrice) / pos.entryPrice * 100 });
      pos = null;
    }
  }
  if (pos) {
    const lb = bars[bars.length - 1];
    trades.push({ ...pos, exitTime: lb.time, exitPrice: lb.close,
                  pnlPct: (lb.close - pos.entryPrice) / pos.entryPrice * 100, open: true });
  }
  return trades;
}
```

---

## Test Periods and Windows

### Timeframe → days of history fetched

**File:** [backtest.js:167](../backend/src/routes/backtest.js#L167) — `TF_MAP` and `fetchBars`.

```js
const TF_MAP = {
  "1m": { days: 60   },
  "3m": { days: 120  },
  "6m": { days: 210  },
  "1y": { days: 400  },
};

async function fetchBars(symbol, tf) {
  const cfg = TF_MAP[tf] ?? TF_MAP["3m"];
  const { data } = await axios.get(`${DATA_URL}/v2/stocks/${symbol}/bars`, {
    params: {
      timeframe: "1Day",
      start: daysAgo(cfg.days),
      ...
    },
  });
}
```

`daysAgo(n)` is calendar days, so actual trading bars are fewer (~252 trading days per year):

| `timeframe` | Calendar days | Approx trading bars |
|-------------|---------------|---------------------|
| `1m`        | 60            | ~42                 |
| `3m`        | 120           | ~84                 |
| `6m`        | 210           | ~147                |
| `1y`        | 400           | ~280                |

### Indicator warm-up: bars consumed before first signal is possible

Each strategy loops starting at its warm-up index, not from bar 0:

| Strategy | Loop start | Warm-up bars lost | Code line |
|----------|------------|-------------------|-----------|
| RSI      | `i = rsi_period` (14) | 14 | [backtest.js:57](../backend/src/routes/backtest.js#L57) |
| EMA      | `i = slow_period` (21) | 21 | [backtest.js:82](../backend/src/routes/backtest.js#L82) |
| VWAP     | `i = lookback_volume` (20) | 20 | [backtest.js:117](../backend/src/routes/backtest.js#L117) |

On a `1m` run (~42 bars), EMA starts at bar 21 and stops at `bars.length - 2` (needs `i+1` for fill),
leaving only ~19 bars where a signal can fire. You may see 0–2 trades — statistically meaningless.

**Minimum recommended window: `3m` (84 bars)** to get enough trade samples for reliable stats.

---

## Key Limitations

- **Daily bars only** — all three strategies run on `1Day` bars regardless of their intended timeframes
  (RSI is designed for 15m, EMA for 1h, VWAP for 5m in the live Python engine).
- **No position sizing** — each trade is implicitly 100% of capital; P&L is percentage-only.
- **No transaction costs** — slippage, commissions, and spread are ignored.
- **No short selling** — all three simulators are long-only.
- **Rolling VWAP, not session VWAP** — the live VWAP strategy resets each trading session; the
  backtest uses a lookback window approximation.
- **Independent of live Python strategies** — the JS simulators are separate reimplementations;
  parameter changes in the live engine are not automatically reflected here.
