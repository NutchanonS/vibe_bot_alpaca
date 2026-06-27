"""Historical replay validator for the Waterfall scanner.

Replays stages 1-2 (technical indicators) on historical bars for a given date.
Optionally runs stages 3-5 (news fetch, news-analysis LLM, signal-selection LLM).
Measures forward close-to-close returns for the next 1 / 3 / 5 trading days.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

import pandas as pd

from broker.alpaca_client import alpaca
from scanner.universe import get_default_universe, get_tech_universe, get_etfs_only
from agents.news_fetcher_agent import NewsFetcherAgent
from utils.logger import get_logger

log = get_logger(__name__)

_UNIVERSE_MAP = {
    "tech": get_tech_universe,
    "etfs": get_etfs_only,
}

# ── Scoring constants (mirrors screener.py / deep_screener.py) ────────────────
_SCORE_RSI_EXTREME   = 2
_SCORE_EMA_CROSS     = 2
_SCORE_MOMENTUM      = 1
_SCORE_VWAP_NEAR     = 1
_SCORE_BB_SQUEEZE    = 2
_SCORE_VOLUME_SURGE  = 2
_SCORE_REL_STRENGTH  = 1
_SCORE_TREND_ALIGN   = 1

_MIN_AVG_VOL     = 500_000
_MIN_PRICE       = 5.0
_MAX_PRICE       = 2_000.0
_BB_SQ_THRESHOLD = 0.04
_VOL_SURGE_MULT  = 2.0


# ── Date helpers ──────────────────────────────────────────────────────────────

def _close_dt(date_str: str) -> datetime:
    """21:00 UTC on date_str — safely after US market close regardless of DST."""
    d = datetime.fromisoformat(date_str)
    return datetime(d.year, d.month, d.day, 21, 0, 0, tzinfo=timezone.utc)


# ── Indicator helpers ─────────────────────────────────────────────────────────

def _rsi(close: pd.Series, period: int = 14) -> Optional[float]:
    if len(close) < period + 1:
        return None
    delta = close.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, float("nan"))
    val   = (100 - (100 / (1 + rs))).iloc[-1]
    return None if pd.isna(val) else float(val)


def _vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> Optional[float]:
    tp    = (high + low + close) / 3
    cumv  = volume.cumsum()
    if float(cumv.iloc[-1]) <= 0:
        return None
    return float((tp * volume).cumsum().iloc[-1] / cumv.iloc[-1])


def _atr14(high: pd.Series, low: pd.Series, close: pd.Series) -> Optional[float]:
    if len(close) < 15:
        return None
    hl = high - low
    hc = (high - close.shift()).abs()
    lc = (low  - close.shift()).abs()
    tr  = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    val = tr.rolling(14).mean().iloc[-1]
    return float(val) if not pd.isna(val) else None


# ── Validator ─────────────────────────────────────────────────────────────────

class WaterfallValidator:
    """Replays the Waterfall funnel on historical bars and measures forward returns."""

    def __init__(self) -> None:
        self.news_fetcher = NewsFetcherAgent(lookback_hours=24, limit_per_symbol=10)

    # ── Main entry point ───────────────────────────────────────────────────────

    def validate(
        self,
        date: str,
        universe_name: Optional[str] = None,
        stage1_top_n: int = 20,
        stage2_top_n: int = 10,
        include_stage3: bool = True,
        include_stage4: bool = False,
        include_stage5: bool = False,
        forward_days: int = 3,
    ) -> dict:
        end_dt     = _close_dt(date)
        started_at = datetime.now(timezone.utc).isoformat()

        getter   = _UNIVERSE_MAP.get(universe_name or "default", get_default_universe)
        universe = getter()
        log.info("Waterfall validation — date=%s, universe=%d", date, len(universe))

        # ── Stage 1: Indicator screen ──────────────────────────────────────────
        stage1_results: list[dict] = []
        for sym in universe:
            try:
                r = self._score_s1(sym, end_dt)
                if r:
                    stage1_results.append(r)
            except Exception as exc:
                log.debug("S1 hist skipped %s: %s", sym, exc)

        stage1_results.sort(key=lambda r: r["score"], reverse=True)
        stage1_top = stage1_results[:stage1_top_n]

        # ── Stage 2: Deep technical screen ────────────────────────────────────
        spy_ret5      = self._ret5_sym("SPY", end_dt)
        stage2_results: list[dict] = []
        for r in stage1_top:
            try:
                dr = self._score_s2(r, end_dt, spy_ret5)
                stage2_results.append(dr)
            except Exception as exc:
                log.debug("S2 hist skipped %s: %s", r["symbol"], exc)
                stage2_results.append(self._s2_passthrough(r))

        stage2_results.sort(key=lambda r: r["combined_score"], reverse=True)
        stage2_top = stage2_results[:stage2_top_n]
        symbols    = [r["symbol"] for r in stage2_top]

        # ── Stage 3: Historical news ───────────────────────────────────────────
        news_by_symbol: dict[str, list] = {}
        news_snapshots_list = []
        if include_stage3 and symbols:
            start_iso = (end_dt - timedelta(days=1)).isoformat()
            end_iso   = end_dt.isoformat()
            try:
                news_snapshots_list = self.news_fetcher.fetch(
                    symbols, start_iso=start_iso, end_iso=end_iso
                )
                for ns in news_snapshots_list:
                    news_by_symbol[ns.symbol] = [
                        {
                            "headline":   a.headline,
                            "summary":    a.summary,
                            "source":     a.source,
                            "url":        a.url,
                            "created_at": a.created_at.isoformat(),
                        }
                        for a in ns.articles
                    ]
            except Exception as exc:
                log.error("Stage 3 news fetch failed: %s", exc)

        # ── Stage 4: News analysis LLM (optional) ─────────────────────────────
        sentiments: dict[str, dict] = {}
        if include_stage4 and include_stage3 and symbols and news_snapshots_list:
            try:
                from agents.news_analysis_agent import NewsAnalysisAgent
                na    = NewsAnalysisAgent()
                state = {"symbols": symbols, "news_snapshots": news_snapshots_list}
                state = na.run(state)
                for sent in (state.get("news_sentiments") or []):
                    sym = (
                        getattr(sent, "symbol", None)
                        or (sent.get("symbol", "") if isinstance(sent, dict) else "")
                    )
                    sentiments[sym] = {
                        "score":   float(getattr(sent, "score", 0) or (sent.get("score", 0) if isinstance(sent, dict) else 0) or 0),
                        "summary": str(getattr(sent, "summary", "") or ""),
                        "themes":  list(getattr(sent, "themes",  []) or []),
                    }
            except Exception as exc:
                log.error("Stage 4 news LLM failed: %s", exc)

        # ── Stage 5: Signal selection LLM (optional) ──────────────────────────
        signal_sels: dict[str, dict] = {}
        if include_stage5 and symbols:
            try:
                from agents.signal_selection_agent import SignalSelectionAgent
                market_snapshots = [
                    {
                        "symbol":             r["symbol"],
                        "latest_price":       r.get("latest_price", 0),
                        "rsi":                r.get("rsi"),
                        "ema9":               r.get("ema9"),
                        "ema21":              r.get("ema21"),
                        "vwap":               r.get("vwap"),
                        "momentum_5bar_pct":  r.get("momentum_5bar_pct"),
                        "screener_signals":   r.get("screener_signals", []),
                        "deep_signals":       r.get("deep_signals", []),
                        "bb_squeeze":         r.get("bb_squeeze", False),
                        "volume_surge":       r.get("volume_surge", False),
                    }
                    for r in stage2_top
                ]
                state = {
                    "symbols":          symbols,
                    "market_snapshots": market_snapshots,
                    "news_sentiments":  list(sentiments.values()),
                    "signal_selections": [],
                }
                state = SignalSelectionAgent().run(state)
                for sel in (state.get("signal_selections") or []):
                    sym = (
                        getattr(sel, "symbol", None)
                        or (sel.get("symbol", "") if isinstance(sel, dict) else "")
                    )
                    signal_sels[sym] = {
                        "direction":  str(getattr(sel, "direction", "NO_TRADE") or "NO_TRADE"),
                        "confidence": float(getattr(sel, "confidence", 0) or 0),
                        "reasoning":  str(getattr(sel, "reasoning",  "") or ""),
                    }
            except Exception as exc:
                log.error("Stage 5 signal LLM failed: %s", exc)

        # ── Forward returns ────────────────────────────────────────────────────
        forward_returns: dict[str, dict] = {}
        for sym in symbols:
            try:
                forward_returns[sym] = self._forward_daily(sym, date, forward_days)
            except Exception as exc:
                log.warning("Forward returns failed %s: %s", sym, exc)
                forward_returns[sym] = {}

        bench = self._universe_benchmark(universe[:20], date, forward_days)

        # ── Build ranked rows ──────────────────────────────────────────────────
        ranked = []
        for r in stage2_top:
            sym = r["symbol"]
            fwd = forward_returns.get(sym, {})
            ranked.append({
                "symbol":          sym,
                "stage1_score":    round(r["score"], 3),
                "deep_score":      round(r.get("deep_score", 0), 3),
                "combined_score":  round(r["combined_score"], 3),
                "latest_price":    r.get("latest_price"),
                "rsi":             r.get("rsi"),
                "ema9":            r.get("ema9"),
                "ema21":           r.get("ema21"),
                "vwap":            r.get("vwap"),
                "screener_signals": r.get("screener_signals", []),
                "deep_signals":    r.get("deep_signals", []),
                "bb_squeeze":      r.get("bb_squeeze", False),
                "volume_surge":    r.get("volume_surge", False),
                "news_count":      len(news_by_symbol.get(sym, [])),
                "news":            news_by_symbol.get(sym, [])[:5],
                "sentiment":       sentiments.get(sym, {}),
                "signal":          signal_sels.get(sym, {}),
                "forward_1d":      fwd.get("d1"),
                "forward_3d":      fwd.get("d3"),
                "forward_5d":      fwd.get("d5"),
            })

        # ── Summary stats ──────────────────────────────────────────────────────
        v1 = [r["forward_1d"] for r in ranked if r["forward_1d"] is not None]
        v3 = [r["forward_3d"] for r in ranked if r["forward_3d"] is not None]
        v5 = [r["forward_5d"] for r in ranked if r["forward_5d"] is not None]

        def _wr(vals: list) -> Optional[float]:
            return round(sum(1 for x in vals if x > 0) / len(vals), 3) if vals else None

        def _avg(vals: list) -> Optional[float]:
            return round(sum(vals) / len(vals), 3) if vals else None

        summary = {
            "n_universe":    len(universe),
            "n_stage1":      len(stage1_results),
            "n_stage1_top":  len(stage1_top),
            "n_stage2":      len(stage2_results),
            "n_final":       len(ranked),
            "win_rate_1d":   _wr(v1),
            "win_rate_3d":   _wr(v3),
            "win_rate_5d":   _wr(v5),
            "avg_return_1d": _avg(v1),
            "avg_return_3d": _avg(v3),
            "avg_return_5d": _avg(v5),
            "benchmark_avg_return_3d": bench,
        }

        return {
            "status":           "ok",
            "scanner_type":     "waterfall",
            "validation_date":  date,
            "forward_days":     forward_days,
            "stages_run": {
                "stage3_news":  include_stage3,
                "stage4_llm":   include_stage4,
                "stage5_llm":   include_stage5,
            },
            "started_at":       started_at,
            "completed_at":     datetime.now(timezone.utc).isoformat(),
            "universe_name":    universe_name or "default",
            "universe_size":    len(universe),
            "summary":          summary,
            "ranked":           ranked,
            "funnel": [
                {"stage": "Universe",                    "count": len(universe)},
                {"stage": "Stage 1 — any signal",        "count": len(stage1_results)},
                {"stage": f"Stage 1 top {stage1_top_n}", "count": len(stage1_top)},
                {"stage": "Stage 2 — deep scored",       "count": len(stage2_results)},
                {"stage": f"Stage 2 top {stage2_top_n}", "count": len(stage2_top)},
                {"stage": "Has news",                    "count": sum(1 for s in symbols if news_by_symbol.get(s))},
                {"stage": "Signal (BUY/SELL)",           "count": sum(1 for v in signal_sels.values() if v.get("direction") not in ("NO_TRADE", ""))},
            ],
        }

    # ── Multi-date sweep ──────────────────────────────────────────────────────

    def sweep(
        self,
        start_date: str,
        end_date: str,
        universe_name: Optional[str] = None,
        stage1_top_n: int = 20,
        stage2_top_n: int = 10,
        include_stage3: bool = True,
        include_stage4: bool = False,
        include_stage5: bool = False,
        forward_days: int = 3,
        sample_every: int = 1,
        progress_cb=None,
    ) -> dict:
        """Run validate() on every sampled business day in [start_date, end_date].

        progress_cb(step, total, current_date) is called after each day.
        Returns aggregated stats and a per-date breakdown list.
        """
        started_at = datetime.now(timezone.utc).isoformat()

        # Build candidate date list (business days only — weekends already excluded)
        start_dt = datetime.fromisoformat(start_date)
        end_dt   = datetime.fromisoformat(end_date)
        all_days: list[str] = []
        cur = start_dt
        while cur <= end_dt:
            if cur.weekday() < 5:   # Mon–Fri
                all_days.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)

        sampled_days = all_days[::max(1, sample_every)]
        total        = len(sampled_days)
        log.info("Waterfall sweep — %d dates (%s to %s), sample_every=%d",
                 total, start_date, end_date, sample_every)

        by_date: list[dict] = []
        all_picks: list[float] = []
        all_picks_3d: list[float] = []

        for step, date in enumerate(sampled_days, 1):
            try:
                result = self.validate(
                    date=date,
                    universe_name=universe_name,
                    stage1_top_n=stage1_top_n,
                    stage2_top_n=stage2_top_n,
                    include_stage3=include_stage3,
                    include_stage4=include_stage4,
                    include_stage5=include_stage5,
                    forward_days=forward_days,
                )

                ranked = result.get("ranked", [])
                v1  = [r["forward_1d"] for r in ranked if r.get("forward_1d") is not None]
                v3  = [r["forward_3d"] for r in ranked if r.get("forward_3d") is not None]
                all_picks.extend(v1)
                all_picks_3d.extend(v3)

                def _wr(vals: list) -> Optional[float]:
                    return round(sum(1 for x in vals if x > 0) / len(vals), 3) if vals else None

                def _avg(vals: list) -> Optional[float]:
                    return round(sum(vals) / len(vals), 3) if vals else None

                by_date.append({
                    "date":          date,
                    "n_picks":       len(ranked),
                    "n_stage1":      result.get("summary", {}).get("n_stage1", 0),
                    "n_stage2":      result.get("summary", {}).get("n_stage2", 0),
                    "win_rate_1d":   _wr(v1),
                    "win_rate_3d":   _wr(v3),
                    "avg_return_1d": _avg(v1),
                    "avg_return_3d": _avg(v3),
                    "picks":         [{"symbol": r["symbol"], "score": r["combined_score"],
                                       "forward_1d": r.get("forward_1d"), "forward_3d": r.get("forward_3d")}
                                      for r in ranked],
                })
            except Exception as exc:
                log.warning("Sweep skipped %s: %s", date, exc)
                by_date.append({"date": date, "n_picks": 0, "error": str(exc)})

            if progress_cb:
                try:
                    progress_cb(step, total, date)
                except Exception:
                    pass

        def _wr(vals: list) -> Optional[float]:
            return round(sum(1 for x in vals if x > 0) / len(vals), 3) if vals else None

        def _avg(vals: list) -> Optional[float]:
            return round(sum(vals) / len(vals), 3) if vals else None

        days_with_picks = sum(1 for d in by_date if d.get("n_picks", 0) > 0)

        summary = {
            "total_days":         total,
            "days_completed":     len(by_date),
            "days_with_picks":    days_with_picks,
            "total_picks":        len(all_picks),
            "overall_win_rate_1d": _wr(all_picks),
            "overall_win_rate_3d": _wr(all_picks_3d),
            "overall_avg_return_1d": _avg(all_picks),
            "overall_avg_return_3d": _avg(all_picks_3d),
        }

        return {
            "status":       "ok",
            "scanner_type": "waterfall",
            "mode":         "sweep",
            "start_date":   start_date,
            "end_date":     end_date,
            "sample_every": sample_every,
            "forward_days": forward_days,
            "stages_run": {
                "stage3_news": include_stage3,
                "stage4_llm":  include_stage4,
                "stage5_llm":  include_stage5,
            },
            "started_at":   started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "summary":      summary,
            "by_date":      by_date,
        }

    # ── Stage 1 ───────────────────────────────────────────────────────────────

    def _score_s1(self, symbol: str, end_dt: datetime) -> Optional[dict]:
        bars = _fetch_hist(symbol, "15Min", 50, end_dt)
        if bars is None or len(bars) < 21:
            return None

        close  = bars["close"].astype(float)
        high   = bars["high"].astype(float)
        low    = bars["low"].astype(float)
        volume = bars["volume"].astype(float)

        latest_price = float(close.iloc[-1])
        avg_volume   = float(volume.mean())

        if not (_MIN_PRICE <= latest_price <= _MAX_PRICE):
            return None
        if avg_volume < _MIN_AVG_VOL:
            return None

        score: float     = 0.0
        signals: list    = []

        rsi_val = _rsi(close)
        if rsi_val is not None:
            if rsi_val < 35:
                score += _SCORE_RSI_EXTREME
                signals.append(f"RSI oversold ({rsi_val:.1f})")
            elif rsi_val > 65:
                score += _SCORE_RSI_EXTREME
                signals.append(f"RSI overbought ({rsi_val:.1f})")

        ema9_s  = close.ewm(span=9,  adjust=False).mean()
        ema21_s = close.ewm(span=21, adjust=False).mean()
        ema9  = float(ema9_s.iloc[-1])  if not pd.isna(ema9_s.iloc[-1])  else None
        ema21 = float(ema21_s.iloc[-1]) if not pd.isna(ema21_s.iloc[-1]) else None

        if len(bars) >= 4:
            for i in range(-3, 0):
                p9, p21 = float(ema9_s.iloc[i-1]), float(ema21_s.iloc[i-1])
                c9, c21 = float(ema9_s.iloc[i]),   float(ema21_s.iloc[i])
                if p9 <= p21 and c9 > c21:
                    score += _SCORE_EMA_CROSS
                    signals.append("EMA9 crossed above EMA21 (bullish)")
                    break
                if p9 >= p21 and c9 < c21:
                    score += _SCORE_EMA_CROSS
                    signals.append("EMA9 crossed below EMA21 (bearish)")
                    break

        momentum = None
        if len(close) >= 6:
            momentum = float((close.iloc[-1] - close.iloc[-6]) / close.iloc[-6]) * 100
            if abs(momentum) > 1.5:
                score += _SCORE_MOMENTUM
                signals.append(f"5-bar momentum {'up' if momentum > 0 else 'down'} {abs(momentum):.2f}%")

        vwap_val = _vwap(high, low, close, volume)
        atr_val  = _atr14(high, low, close)
        if vwap_val is not None and atr_val is not None and atr_val > 0:
            if abs(latest_price - vwap_val) <= atr_val:
                score += _SCORE_VWAP_NEAR
                signals.append(f"Price within 1 ATR of VWAP (${vwap_val:.2f})")

        return {
            "symbol":              symbol,
            "score":               score,
            "latest_price":        latest_price,
            "avg_volume":          avg_volume,
            "rsi":                 rsi_val,
            "ema9":                ema9,
            "ema21":               ema21,
            "momentum_5bar_pct":   momentum,
            "vwap":                vwap_val,
            "screener_signals":    signals,
        }

    # ── Stage 2 ───────────────────────────────────────────────────────────────

    def _score_s2(self, s1: dict, end_dt: datetime, spy_ret5: Optional[float]) -> dict:
        bars = _fetch_hist(s1["symbol"], "15Min", 100, end_dt)
        if bars is None or len(bars) < 21:
            return self._s2_passthrough(s1)

        close  = bars["close"].astype(float)
        volume = bars["volume"].astype(float)

        deep_score: float = 0.0
        deep_sigs: list   = []
        bb_sq  = False
        vol_sg = False

        # Bollinger squeeze
        if len(close) >= 20:
            mid = close.rolling(20).mean()
            std = close.rolling(20).std()
            bb_w = ((mid + 2 * std) - (mid - 2 * std)) / mid
            if not pd.isna(bb_w.iloc[-1]) and float(bb_w.iloc[-1]) < _BB_SQ_THRESHOLD:
                bb_sq = True
                deep_score += _SCORE_BB_SQUEEZE
                deep_sigs.append("Bollinger Band squeeze")

        # Volume surge
        avg_v = float(volume.iloc[-20:].mean()) if len(volume) >= 20 else float(volume.mean())
        if avg_v > 0 and float(volume.iloc[-1]) > avg_v * _VOL_SURGE_MULT:
            vol_sg = True
            deep_score += _SCORE_VOLUME_SURGE
            deep_sigs.append(f"Volume surge (>{_VOL_SURGE_MULT:.0f}× 20-bar avg)")

        # RS vs SPY
        if len(close) >= 6:
            sym_r5 = float((close.iloc[-1] - close.iloc[-6]) / close.iloc[-6]) * 100
            if spy_ret5 is not None and sym_r5 > spy_ret5:
                deep_score += _SCORE_REL_STRENGTH
                deep_sigs.append(f"Outperforming SPY by {sym_r5 - spy_ret5:+.2f}%")

        # Trend alignment
        if len(close) >= 50:
            ema50 = float(close.ewm(span=50, adjust=False).mean().iloc[-1])
            if float(close.iloc[-1]) > ema50:
                deep_score += _SCORE_TREND_ALIGN
                deep_sigs.append("Price above EMA(50)")

        return {
            **s1,
            "deep_score":     deep_score,
            "combined_score": s1["score"] + deep_score,
            "bb_squeeze":     bb_sq,
            "volume_surge":   vol_sg,
            "deep_signals":   deep_sigs,
        }

    def _s2_passthrough(self, s1: dict) -> dict:
        return {**s1, "deep_score": 0.0, "combined_score": s1["score"],
                "bb_squeeze": False, "volume_surge": False, "deep_signals": []}

    # ── Forward returns ────────────────────────────────────────────────────────

    def _forward_daily(self, symbol: str, date: str, forward_days: int) -> dict:
        """Close-to-close returns for next 1/3/5 trading days from validation date."""
        end_dt = _close_dt(date)
        # Reference close = last daily bar on or before validation date
        ref_bars = _fetch_hist(symbol, "1Day", 3, end_dt)
        if ref_bars is None or ref_bars.empty:
            return {}
        ref_close = float(ref_bars["close"].iloc[-1])
        if ref_close <= 0:
            return {}

        # Forward bars starting the next trading day
        fwd_start = end_dt + timedelta(days=1)
        fwd_end   = end_dt + timedelta(days=forward_days + 5)  # buffer for weekends
        fwd_bars  = alpaca.get_bars(symbol, "1Day", limit=forward_days + 5,
                                    start=fwd_start, end=fwd_end)
        if fwd_bars is None or fwd_bars.empty:
            return {}

        fwd_close = fwd_bars["close"].astype(float)
        result: dict = {}
        for n, key in [(0, "d1"), (2, "d3"), (4, "d5")]:
            if n < len(fwd_close):
                ret = (float(fwd_close.iloc[n]) - ref_close) / ref_close * 100
                result[key] = round(ret, 3)
        return result

    def _universe_benchmark(self, sample: list, date: str, forward_days: int) -> Optional[float]:
        """Average 3-day return of a random sample of universe symbols."""
        returns = []
        for sym in sample[:15]:
            try:
                fwd = self._forward_daily(sym, date, forward_days)
                if fwd.get("d3") is not None:
                    returns.append(fwd["d3"])
            except Exception:
                pass
        return round(sum(returns) / len(returns), 3) if returns else None

    def _ret5_sym(self, symbol: str, end_dt: datetime) -> Optional[float]:
        bars = _fetch_hist(symbol, "15Min", 10, end_dt)
        if bars is None or len(bars) < 6:
            return None
        close = bars["close"].astype(float)
        return float((close.iloc[-1] - close.iloc[-6]) / close.iloc[-6]) * 100


# ── Shared fetch helper ───────────────────────────────────────────────────────

def _fetch_hist(symbol: str, timeframe: str, limit: int, end_dt: datetime) -> Optional[pd.DataFrame]:
    try:
        bars = alpaca.get_bars(symbol, timeframe, limit=limit, end=end_dt)
        if bars is None or (isinstance(bars, pd.DataFrame) and bars.empty):
            return None
        if not isinstance(bars, pd.DataFrame):
            bars = pd.DataFrame(bars)
        required = {"open", "high", "low", "close", "volume"}
        if not required.issubset(set(bars.columns)):
            return None
        return bars
    except Exception:
        return None
