"""High-momentum scan pipeline — 5-stage funnel.

Stage 1  MomentumScreener        universe (50-200) → top 20 by % change × RVOL
Stage 2  MomentumQualityScreener stage1 survivors  → top 10 by quality
Stage 3  News fetch               stage2 survivors  → articles (last 4 h)
Stage 4  CatalystClassifierAgent  news + price data → catalyst type/quality (LLM × ~10)
Stage 5  MomentumSignalAgent      structure + catalyst → intraday plan (LLM × ~10)

Contrast with WaterfallScanPipeline:
  • Universe is dynamic (live movers), not a fixed list
  • Entry criteria are catalyst-driven, not indicator-driven
  • LLM output is an intraday plan (entry zone, 2 targets, hold time)
  • Position sizing is 1–3% vs the normal max
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from typing import Any

from scanner.momentum_universe import get_momentum_universe
from scanner.momentum_screener import MomentumScreener
from scanner.momentum_quality_screen import MomentumQualityScreener
from agents.news_fetcher_agent import NewsFetcherAgent
from agents.catalyst_classifier_agent import CatalystClassifierAgent
from agents.momentum_signal_agent import MomentumSignalAgent
from utils.logger import get_logger

log = get_logger(__name__)

# How far back to look for news (shorter window = fresher catalyst)
NEWS_LOOKBACK_HOURS = 4


class MomentumScanPipeline:
    """Runs the 5-stage momentum scan and returns ranked results."""

    def __init__(self) -> None:
        self.stage1        = MomentumScreener()
        self.stage2        = MomentumQualityScreener()
        self.news_fetcher  = NewsFetcherAgent(
            lookback_hours=NEWS_LOOKBACK_HOURS,
            limit_per_symbol=8,
        )
        self.catalyst_agent = CatalystClassifierAgent()
        self.signal_agent   = MomentumSignalAgent()

    def run(
        self,
        universe: list[str] | None = None,
        stage1_top_n: int = 20,
        stage2_top_n: int = 10,
    ) -> dict:
        started_at = datetime.now(timezone.utc).isoformat()

        if universe is None:
            universe = get_momentum_universe()

        log.info(
            "Momentum scan started — universe=%d, s1_top_n=%d, s2_top_n=%d",
            len(universe), stage1_top_n, stage2_top_n,
        )

        # ── Stage 1: Momentum pre-filter ──────────────────────────────────────
        stage1_results = []
        try:
            stage1_results = self.stage1.screen(universe, top_n=stage1_top_n)
            log.info("Stage 1 → %d survivors: %s",
                     len(stage1_results), [r.symbol for r in stage1_results])
        except Exception as exc:
            log.error("Stage 1 momentum screener failed: %s", exc)

        if not stage1_results:
            return self._empty(started_at, len(universe))

        # ── Stage 2: Quality screen ───────────────────────────────────────────
        stage2_results = []
        try:
            stage2_results = self.stage2.screen(stage1_results, top_n=stage2_top_n)
            log.info("Stage 2 → %d survivors: %s",
                     len(stage2_results), [r.symbol for r in stage2_results])
        except Exception as exc:
            log.error("Stage 2 momentum quality screen failed: %s", exc)
            stage2_results = stage1_results[:stage2_top_n]  # type: ignore[assignment]

        candidate_symbols = [
            (r.symbol if hasattr(r, "symbol") else r.get("symbol", ""))
            for r in stage2_results
        ]

        # ── Stage 3: News fetch (fresh 4-hour window) ─────────────────────────
        news_snapshots: list[Any] = []
        try:
            news_snapshots = self.news_fetcher.fetch(
                candidate_symbols,
                lookback_hours=NEWS_LOOKBACK_HOURS,
            )
            log.info("Stage 3 → fetched news for %d symbols", len(news_snapshots))
        except Exception as exc:
            log.error("Stage 3 news fetch failed: %s", exc)

        # ── Stage 4: Catalyst classification (LLM) ───────────────────────────
        pipeline_state: dict = {
            "symbols":                  candidate_symbols,
            "momentum_stage2":          stage2_results,
            "momentum_news_snapshots":  news_snapshots,
        }
        try:
            pipeline_state = self.catalyst_agent.run(pipeline_state)
            log.info("Stage 4 → catalyst results for %d symbols",
                     len(pipeline_state.get("catalyst_results", {})))
        except Exception as exc:
            log.error("Stage 4 catalyst classifier failed: %s", exc)
            pipeline_state["catalyst_results"] = {}

        # ── Stage 5: Momentum signal (LLM) ───────────────────────────────────
        try:
            pipeline_state = self.signal_agent.run(pipeline_state)
            log.info("Stage 5 → momentum signals for %d symbols",
                     len(pipeline_state.get("momentum_signals", {})))
        except Exception as exc:
            log.error("Stage 5 momentum signal agent failed: %s", exc)
            pipeline_state["momentum_signals"] = {}

        # ── Build ranked output ───────────────────────────────────────────────
        ranked = self._build_ranked(
            stage2_results,
            pipeline_state.get("catalyst_results", {}),
            pipeline_state.get("momentum_signals",  {}),
        )

        return {
            "status":         "ok",
            "started_at":     started_at,
            "completed_at":   datetime.now(timezone.utc).isoformat(),
            "universe_size":  len(universe),
            "stage1_count":   len(stage1_results),
            "stage2_count":   len(stage2_results),
            "ranked":         ranked,
        }

    # ── Ranked output ─────────────────────────────────────────────────────────

    def _build_ranked(
        self,
        stage2_results:   list[Any],
        catalyst_results: dict[str, Any],
        momentum_signals: dict[str, Any],
    ) -> list[dict]:
        rows: list[dict] = []

        for sr in stage2_results:
            sym = self._get(sr, "symbol", "")
            cat = catalyst_results.get(sym) or {}
            sig = momentum_signals.get(sym)  or {}

            # Flatten catalyst
            cat_type    = self._get(cat, "catalyst_type",    "unknown")
            cat_quality = self._get(cat, "catalyst_quality", "unknown")
            sustainable = self._get(cat, "is_sustainable",   False)
            risk_flags  = self._get(cat, "risk_flags",       [])
            cat_summary = self._get(cat, "summary",          "")
            cat_conf    = float(self._get(cat, "confidence", 0.0) or 0.0)
            cat_headlines = self._get(cat, "key_headlines",  [])

            # Flatten signal
            direction   = str(self._get(sig, "direction",         "NO_TRADE"))
            entry_low   = float(self._get(sig, "entry_zone_low",  0) or 0)
            entry_high  = float(self._get(sig, "entry_zone_high", 0) or 0)
            stop_loss   = float(self._get(sig, "stop_loss",       0) or 0)
            target_1    = float(self._get(sig, "target_1",        0) or 0)
            target_2    = float(self._get(sig, "target_2",        0) or 0)
            hold_min    = int(self._get(sig,   "hold_minutes",   60) or 60)
            pos_size    = float(self._get(sig, "position_size_pct", 1.0) or 1.0)
            sig_conf    = float(self._get(sig, "confidence",     0.0) or 0.0)
            rr_ratio    = float(self._get(sig, "risk_reward",    0.0) or 0.0)
            reasoning   = str(self._get(sig,   "reasoning",      ""))

            rows.append({
                "symbol":           sym,
                # Stage 1 & 2 metrics
                "change_pct":       self._get(sr, "change_pct"),
                "rvol":             self._get(sr, "rvol"),
                "latest_price":     self._get(sr, "latest_price"),
                "intraday_volume":  self._get(sr, "intraday_volume"),
                "day_high":         self._get(sr, "day_high"),
                "vwap":             self._get(sr, "vwap"),
                "stage1_score":     self._get(sr, "stage1_score"),
                "deep_score":       self._get(sr, "deep_score"),
                "combined_score":   self._get(sr, "combined_score"),
                "hod_hold":         bool(self._get(sr, "hod_hold",    False)),
                "flag_pattern":     bool(self._get(sr, "flag_pattern", False)),
                "vwap_reclaim":     bool(self._get(sr, "vwap_reclaim", False)),
                "stage1_signals":   list(self._get(sr, "stage1_signals", [])),
                "deep_signals":     list(self._get(sr, "deep_signals",   [])),
                # Catalyst (Stage 4)
                "catalyst_type":    cat_type,
                "catalyst_quality": cat_quality,
                "is_sustainable":   bool(sustainable),
                "risk_flags":       risk_flags,
                "catalyst_summary": cat_summary,
                "catalyst_confidence": cat_conf,
                "key_headlines":    cat_headlines,
                # Signal (Stage 5)
                "direction":        direction,
                "entry_zone_low":   entry_low,
                "entry_zone_high":  entry_high,
                "stop_loss":        stop_loss,
                "target_1":         target_1,
                "target_2":         target_2,
                "hold_minutes":     hold_min,
                "position_size_pct": pos_size,
                "signal_confidence": sig_conf,
                "rr_ratio":         rr_ratio,
                "reasoning":        reasoning,
            })

        # Sort: actionable first → highest signal confidence → highest RVOL
        rows.sort(key=lambda r: (
            0 if r["direction"] != "NO_TRADE" else 1,
            -(r["signal_confidence"] or 0),
            -(r["rvol"] or 0),
        ))
        return rows

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _get(obj: Any, key: str, default: Any = None) -> Any:
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    @staticmethod
    def _empty(started_at: str, universe_size: int) -> dict:
        return {
            "status":        "ok",
            "started_at":    started_at,
            "completed_at":  datetime.now(timezone.utc).isoformat(),
            "universe_size": universe_size,
            "stage1_count":  0,
            "stage2_count":  0,
            "ranked":        [],
        }
