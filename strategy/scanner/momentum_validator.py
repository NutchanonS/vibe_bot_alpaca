"""Historical replay validator for the Momentum scanner.

Stage 1 uses daily bars to reconstruct % change and RVOL for a given date
(the live scanner uses the snapshots API which has no historical mode).
Stage 2 uses 1-minute intraday bars for the morning session of that date.
Stages 3-5 (news, catalyst LLM, signal LLM) are optional.

Forward performance is measured intraday:
  m30  — price 30 min after market open vs open
  m60  — price 60 min after market open vs open
  eod  — close vs open
  d1   — next trading day close vs open
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

import pandas as pd

from broker.alpaca_client import alpaca
from scanner.momentum_universe import _VOLATILE_UNIVERSE
from agents.news_fetcher_agent import NewsFetcherAgent
from utils.logger import get_logger

log = get_logger(__name__)

# ── Stage 1 gates (mirrors MomentumScreener) ──────────────────────────────────
_MIN_CHANGE_PCT   = 5.0
_MIN_RVOL         = 3.0
_MIN_PRICE        = 1.0
_MAX_PRICE        = 100.0
_MIN_INTRADAY_VOL = 500_000

# ── Stage 2 scoring (mirrors MomentumQualityScreener) ─────────────────────────
_HOD_HOLD_PCT     = 0.20
_FLAG_BARS        = 5
_FLAG_TIGHTEN_PCT = 0.50
_SCORE_HOD_HOLD   = 1
_SCORE_FLAG       = 2
_SCORE_VWAP       = 2
_SCORE_SPREAD     = 1


def _close_dt(date_str: str) -> datetime:
    d = datetime.fromisoformat(date_str)
    return datetime(d.year, d.month, d.day, 21, 0, 0, tzinfo=timezone.utc)


def _open_dt(date_str: str) -> datetime:
    """US market open — 13:30 UTC (= 9:30 AM ET, ignoring DST offset which moves it to 14:30)."""
    d = datetime.fromisoformat(date_str)
    # Use 13:30 UTC as a conservative pre-market open; Alpaca returns bars from 9:30 AM ET
    return datetime(d.year, d.month, d.day, 14, 30, 0, tzinfo=timezone.utc)


class MomentumValidator:
    """Replays the Momentum funnel on historical bars and measures intraday forward returns."""

    def __init__(self) -> None:
        self.news_fetcher = NewsFetcherAgent(lookback_hours=4, limit_per_symbol=8)

    # ── Main entry point ───────────────────────────────────────────────────────

    def validate(
        self,
        date: str,
        stage1_top_n: int = 20,
        stage2_top_n: int = 10,
        include_stage3: bool = True,
        include_stage4: bool = False,
        include_stage5: bool = False,
    ) -> dict:
        end_dt     = _close_dt(date)
        started_at = datetime.now(timezone.utc).isoformat()
        universe   = list(_VOLATILE_UNIVERSE)
        log.info("Momentum validation — date=%s, universe=%d", date, len(universe))

        # ── Stage 1: Historical daily bars ────────────────────────────────────
        stage1_results: list[dict] = []
        for sym in universe:
            try:
                r = self._screen_s1(sym, date)
                if r:
                    stage1_results.append(r)
            except Exception as exc:
                log.debug("Mom S1 hist skipped %s: %s", sym, exc)

        stage1_results.sort(key=lambda r: r["score"], reverse=True)
        stage1_top = stage1_results[:stage1_top_n]

        # ── Stage 2: Intraday quality screen ──────────────────────────────────
        stage2_results: list[dict] = []
        for r in stage1_top:
            try:
                dr = self._screen_s2(r, date)
                stage2_results.append(dr)
            except Exception as exc:
                log.debug("Mom S2 hist skipped %s: %s", r["symbol"], exc)
                stage2_results.append(self._s2_passthrough(r))

        stage2_results.sort(key=lambda r: r["combined_score"], reverse=True)
        stage2_top = stage2_results[:stage2_top_n]
        symbols    = [r["symbol"] for r in stage2_top]

        # ── Stage 3: Historical news ───────────────────────────────────────────
        news_by_symbol: dict[str, list] = {}
        news_snapshots_list = []
        if include_stage3 and symbols:
            start_iso = (end_dt - timedelta(hours=4)).isoformat()
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

        # ── Stage 4: Catalyst LLM (optional) ──────────────────────────────────
        catalysts: dict[str, dict] = {}
        if include_stage4 and include_stage3 and symbols and news_snapshots_list:
            try:
                from agents.catalyst_classifier_agent import CatalystClassifierAgent
                state = {
                    "symbols":        symbols,
                    "news_snapshots": news_snapshots_list,
                    "stage2_results": stage2_top,
                }
                state = CatalystClassifierAgent().run(state)
                for cat in (state.get("catalyst_results") or []):
                    sym = (
                        getattr(cat, "symbol", None)
                        or (cat.get("symbol", "") if isinstance(cat, dict) else "")
                    )
                    catalysts[sym] = {
                        "catalyst_type":    str(getattr(cat, "catalyst_type", "")    or ""),
                        "catalyst_quality": str(getattr(cat, "catalyst_quality", "") or ""),
                        "reasoning":        str(getattr(cat, "reasoning", "")        or ""),
                    }
            except Exception as exc:
                log.error("Stage 4 catalyst LLM failed: %s", exc)

        # ── Stage 5: Signal LLM (optional) ────────────────────────────────────
        signal_sels: dict[str, dict] = {}
        if include_stage5 and symbols:
            try:
                from agents.momentum_signal_agent import MomentumSignalAgent
                state = {
                    "symbols":          symbols,
                    "stage2_results":   stage2_top,
                    "catalyst_results": list(catalysts.values()),
                    "news_snapshots":   news_snapshots_list,
                    "momentum_signals": [],
                }
                state = MomentumSignalAgent().run(state)
                for sel in (state.get("momentum_signals") or []):
                    sym = (
                        getattr(sel, "symbol", None)
                        or (sel.get("symbol", "") if isinstance(sel, dict) else "")
                    )
                    signal_sels[sym] = {
                        "direction":    str(getattr(sel, "direction",    "NO_TRADE") or "NO_TRADE"),
                        "confidence":   float(getattr(sel, "confidence", 0) or 0),
                        "entry_zone":   str(getattr(sel, "entry_zone",   "") or ""),
                        "target1":      float(getattr(sel, "target1",    0) or 0),
                        "target2":      float(getattr(sel, "target2",    0) or 0),
                        "stop_loss":    float(getattr(sel, "stop_loss",  0) or 0),
                        "hold_minutes": int(getattr(sel,   "hold_minutes", 0) or 0),
                        "reasoning":    str(getattr(sel, "reasoning",    "") or ""),
                    }
            except Exception as exc:
                log.error("Stage 5 momentum signal LLM failed: %s", exc)

        # ── Intraday forward performance ───────────────────────────────────────
        forward_perf: dict[str, dict] = {}
        for sym in symbols:
            try:
                forward_perf[sym] = self._intraday_forward(sym, date)
            except Exception as exc:
                log.warning("Intraday forward failed %s: %s", sym, exc)
                forward_perf[sym] = {}

        # ── Build ranked rows ──────────────────────────────────────────────────
        ranked = []
        for r in stage2_top:
            sym = r["symbol"]
            fwd = forward_perf.get(sym, {})
            ranked.append({
                "symbol":          sym,
                "stage1_score":    round(r["score"], 3),
                "deep_score":      round(r.get("deep_score", 0), 3),
                "combined_score":  round(r["combined_score"], 3),
                "change_pct":      r.get("change_pct"),
                "rvol":            r.get("rvol"),
                "latest_price":    r.get("latest_price"),
                "intraday_volume": r.get("intraday_volume"),
                "hod_hold":        bool(r.get("hod_hold", False)),
                "flag_pattern":    bool(r.get("flag_pattern", False)),
                "vwap_reclaim":    bool(r.get("vwap_reclaim", False)),
                "day_high":        r.get("day_high"),
                "vwap":            r.get("vwap"),
                "stage1_signals":  r.get("stage1_signals", []),
                "deep_signals":    r.get("deep_signals", []),
                "news_count":      len(news_by_symbol.get(sym, [])),
                "news":            news_by_symbol.get(sym, [])[:5],
                "catalyst":        catalysts.get(sym, {}),
                "signal":          signal_sels.get(sym, {}),
                "forward_30m":     fwd.get("m30"),
                "forward_60m":     fwd.get("m60"),
                "forward_eod":     fwd.get("eod"),
                "forward_1d":      fwd.get("d1"),
            })

        v30  = [r["forward_30m"] for r in ranked if r["forward_30m"] is not None]
        veod = [r["forward_eod"] for r in ranked if r["forward_eod"] is not None]

        def _wr(vals: list) -> Optional[float]:
            return round(sum(1 for x in vals if x > 0) / len(vals), 3) if vals else None

        def _avg(vals: list) -> Optional[float]:
            return round(sum(vals) / len(vals), 3) if vals else None

        summary = {
            "n_universe":      len(universe),
            "n_stage1_pass":   len(stage1_results),
            "n_stage1_top":    len(stage1_top),
            "n_stage2":        len(stage2_results),
            "n_final":         len(ranked),
            "win_rate_30m":    _wr(v30),
            "win_rate_eod":    _wr(veod),
            "avg_return_30m":  _avg(v30),
            "avg_return_eod":  _avg(veod),
        }

        return {
            "status":          "ok",
            "scanner_type":    "momentum",
            "validation_date": date,
            "stages_run": {
                "stage3_news":  include_stage3,
                "stage4_llm":   include_stage4,
                "stage5_llm":   include_stage5,
            },
            "started_at":      started_at,
            "completed_at":    datetime.now(timezone.utc).isoformat(),
            "universe_size":   len(universe),
            "summary":         summary,
            "ranked":          ranked,
            "funnel": [
                {"stage": "Universe (curated volatile)",      "count": len(universe)},
                {"stage": "Stage 1 — ≥5% & RVOL ≥3×",       "count": len(stage1_results)},
                {"stage": f"Stage 1 top {stage1_top_n}",     "count": len(stage1_top)},
                {"stage": "Stage 2 — quality scored",         "count": len(stage2_results)},
                {"stage": f"Stage 2 top {stage2_top_n}",     "count": len(stage2_top)},
                {"stage": "Has news (4h window)",             "count": sum(1 for s in symbols if news_by_symbol.get(s))},
                {"stage": "Signal — BUY",                     "count": sum(1 for v in signal_sels.values() if v.get("direction") == "BUY")},
            ],
        }

    # ── Multi-date sweep ──────────────────────────────────────────────────────

    def sweep(
        self,
        start_date: str,
        end_date: str,
        stage1_top_n: int = 20,
        stage2_top_n: int = 10,
        include_stage3: bool = True,
        include_stage4: bool = False,
        include_stage5: bool = False,
        sample_every: int = 1,
        progress_cb=None,
    ) -> dict:
        """Run validate() on every sampled business day in [start_date, end_date]."""
        started_at = datetime.now(timezone.utc).isoformat()

        start_dt = datetime.fromisoformat(start_date)
        end_dt   = datetime.fromisoformat(end_date)
        all_days: list[str] = []
        cur = start_dt
        while cur <= end_dt:
            if cur.weekday() < 5:
                all_days.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)

        sampled_days = all_days[::max(1, sample_every)]
        total        = len(sampled_days)
        log.info("Momentum sweep — %d dates (%s to %s), sample_every=%d",
                 total, start_date, end_date, sample_every)

        by_date: list[dict] = []
        all_30m: list[float] = []
        all_eod: list[float] = []

        for step, date in enumerate(sampled_days, 1):
            try:
                result = self.validate(
                    date=date,
                    stage1_top_n=stage1_top_n,
                    stage2_top_n=stage2_top_n,
                    include_stage3=include_stage3,
                    include_stage4=include_stage4,
                    include_stage5=include_stage5,
                )

                ranked = result.get("ranked", [])
                v30m = [r["forward_30m"] for r in ranked if r.get("forward_30m") is not None]
                veod = [r["forward_eod"] for r in ranked if r.get("forward_eod") is not None]
                all_30m.extend(v30m)
                all_eod.extend(veod)

                def _wr(vals: list) -> Optional[float]:
                    return round(sum(1 for x in vals if x > 0) / len(vals), 3) if vals else None

                def _avg(vals: list) -> Optional[float]:
                    return round(sum(vals) / len(vals), 3) if vals else None

                by_date.append({
                    "date":          date,
                    "n_picks":       len(ranked),
                    "n_stage1":      result.get("summary", {}).get("n_stage1_pass", 0),
                    "win_rate_30m":  _wr(v30m),
                    "win_rate_eod":  _wr(veod),
                    "avg_return_30m": _avg(v30m),
                    "avg_return_eod": _avg(veod),
                    "picks": [{"symbol": r["symbol"], "change_pct": r.get("change_pct"),
                               "forward_30m": r.get("forward_30m"), "forward_eod": r.get("forward_eod")}
                              for r in ranked],
                })
            except Exception as exc:
                log.warning("Momentum sweep skipped %s: %s", date, exc)
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

        return {
            "status":       "ok",
            "scanner_type": "momentum",
            "mode":         "sweep",
            "start_date":   start_date,
            "end_date":     end_date,
            "sample_every": sample_every,
            "stages_run": {
                "stage3_news": include_stage3,
                "stage4_llm":  include_stage4,
                "stage5_llm":  include_stage5,
            },
            "started_at":   started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "total_days":             total,
                "days_completed":         len(by_date),
                "days_with_picks":        days_with_picks,
                "total_picks":            len(all_30m),
                "overall_win_rate_30m":   _wr(all_30m),
                "overall_win_rate_eod":   _wr(all_eod),
                "overall_avg_return_30m": _avg(all_30m),
                "overall_avg_return_eod": _avg(all_eod),
            },
            "by_date": by_date,
        }

    # ── Stage 1: Daily bars ───────────────────────────────────────────────────

    def _screen_s1(self, symbol: str, date: str) -> Optional[dict]:
        end_dt = _close_dt(date)
        bars = alpaca.get_bars(symbol, "1Day", limit=13, end=end_dt)
        if bars is None or bars.empty or len(bars) < 2:
            return None

        bars = bars.reset_index(drop=True)
        latest = bars.iloc[-1]
        prev   = bars.iloc[-2]

        latest_price  = float(latest["close"])
        prev_close    = float(prev["close"])
        intraday_vol  = float(latest.get("volume", 0) or 0)

        if latest_price <= 0 or prev_close <= 0:
            return None
        if not (_MIN_PRICE <= latest_price <= _MAX_PRICE):
            return None

        change_pct = (latest_price - prev_close) / prev_close * 100
        if change_pct < _MIN_CHANGE_PCT:
            return None
        if intraday_vol < _MIN_INTRADAY_VOL:
            return None

        # RVOL from preceding 10 bars' volumes
        hist = bars.iloc[-11:-1]["volume"].astype(float) if len(bars) >= 11 else bars.iloc[:-1]["volume"].astype(float)
        avg_daily_vol = float(hist.mean()) if len(hist) > 0 else 0.0
        rvol = intraday_vol / avg_daily_vol if avg_daily_vol > 0 else 0.0

        if rvol < _MIN_RVOL:
            return None

        change_norm  = min(change_pct / 30.0, 1.0)
        rvol_norm    = min(rvol / 10.0, 1.0)
        quality_bon  = 1.0 if _MIN_PRICE * 3 <= latest_price <= _MAX_PRICE * 0.5 else 0.0
        score        = 0.4 * change_norm + 0.4 * rvol_norm + 0.2 * quality_bon

        return {
            "symbol":          symbol,
            "score":           score,
            "change_pct":      round(change_pct, 2),
            "rvol":            round(rvol, 2),
            "latest_price":    latest_price,
            "prev_close":      prev_close,
            "intraday_volume": intraday_vol,
            "avg_daily_vol":   avg_daily_vol,
            "stage1_signals":  [f"+{change_pct:.1f}% today", f"RVOL {rvol:.1f}×"],
        }

    # ── Stage 2: Intraday quality ─────────────────────────────────────────────

    def _screen_s2(self, s1: dict, date: str) -> dict:
        open_dt = _open_dt(date)
        end_dt  = _close_dt(date)

        try:
            bars = alpaca.get_bars(s1["symbol"], "1Min", limit=60, start=open_dt, end=end_dt)
        except Exception:
            return self._s2_passthrough(s1)

        if bars is None or bars.empty or len(bars) < 5:
            return self._s2_passthrough(s1)

        close  = bars["close"].astype(float)
        high   = bars["high"].astype(float)
        low    = bars["low"].astype(float)
        volume = bars["volume"].astype(float)

        latest_price = float(close.iloc[-1])
        day_high     = float(high.max())
        deep_score   = 0.0
        deep_sigs: list = []

        # HOD hold
        hod_hold = False
        if day_high > 0:
            drawdown = (day_high - latest_price) / day_high
            if drawdown <= _HOD_HOLD_PCT:
                hod_hold = True
                deep_score += _SCORE_HOD_HOLD
                deep_sigs.append(f"Holding within {drawdown*100:.1f}% of HOD")
            else:
                deep_sigs.append(f"Sold off {drawdown*100:.1f}% from HOD — caution")

        # Flag pattern
        flag_pattern = False
        if len(bars) >= _FLAG_BARS:
            wh = high.iloc[-_FLAG_BARS:]
            wl = low.iloc[-_FLAG_BARS:]
            ranges = (wh - wl).values
            if len(ranges) >= 2 and ranges[0] > 0:
                flag_pattern = bool(ranges[-1] <= ranges[0] * _FLAG_TIGHTEN_PCT)
                if flag_pattern:
                    deep_score += _SCORE_FLAG
                    deep_sigs.append("Flag / tight consolidation on 1min bars")

        # VWAP reclaim
        tp   = (high + low + close) / 3
        cumv = volume.cumsum()
        vwap_val = float((tp * volume).cumsum().iloc[-1] / cumv.iloc[-1]) if float(cumv.iloc[-1]) > 0 else None

        vwap_reclaim = False
        if vwap_val is not None and len(close) >= 5:
            above = (close > vwap_val).tolist()
            # Reclaim = was below, now above
            if above[-1] and not all(above[-5:]):
                vwap_reclaim = True
                deep_score += _SCORE_VWAP
                deep_sigs.append(f"VWAP reclaimed at ${vwap_val:.2f}")

        return {
            **s1,
            "deep_score":     deep_score,
            "combined_score": s1["score"] + deep_score,
            "latest_price":   latest_price,
            "day_high":       day_high,
            "vwap":           vwap_val,
            "hod_hold":       hod_hold,
            "flag_pattern":   flag_pattern,
            "vwap_reclaim":   vwap_reclaim,
            "deep_signals":   deep_sigs,
        }

    def _s2_passthrough(self, s1: dict) -> dict:
        return {
            **s1,
            "deep_score":     0.0,
            "combined_score": s1["score"],
            "day_high":       None,
            "vwap":           None,
            "hod_hold":       False,
            "flag_pattern":   False,
            "vwap_reclaim":   False,
            "deep_signals":   [],
        }

    # ── Intraday forward performance ──────────────────────────────────────────

    def _intraday_forward(self, symbol: str, date: str) -> dict:
        open_dt = _open_dt(date)
        end_dt  = _close_dt(date)

        bars = alpaca.get_bars(symbol, "1Min", limit=480, start=open_dt, end=end_dt)
        if bars is None or bars.empty or len(bars) < 5:
            return {}

        close       = bars["close"].astype(float)
        entry_price = float(close.iloc[0])
        if entry_price <= 0:
            return {}

        result: dict = {}

        if len(close) > 30:
            result["m30"] = round((float(close.iloc[29]) - entry_price) / entry_price * 100, 3)
        if len(close) > 60:
            result["m60"] = round((float(close.iloc[59]) - entry_price) / entry_price * 100, 3)

        result["eod"] = round((float(close.iloc[-1]) - entry_price) / entry_price * 100, 3)

        # Next trading day close
        try:
            nxt_start = end_dt + timedelta(days=1)
            nxt_end   = end_dt + timedelta(days=5)
            nxt_bars  = alpaca.get_bars(symbol, "1Day", limit=3, start=nxt_start, end=nxt_end)
            if nxt_bars is not None and not nxt_bars.empty:
                nxt_close = float(nxt_bars["close"].astype(float).iloc[0])
                result["d1"] = round((nxt_close - entry_price) / entry_price * 100, 3)
        except Exception:
            pass

        return result
