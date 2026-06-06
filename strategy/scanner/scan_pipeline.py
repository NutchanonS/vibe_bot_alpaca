"""Waterfall scan pipeline: Stage1 → Stage2 → News → Signal → Risk.

Flow
----
Stage 1  MarketScreener       universe (~110)  →  top stage1_top_n (~20)
Stage 2  DeepScreener         stage1 survivors  →  top stage2_top_n (~10)
Stage 3  News fetch           stage2 survivors  →  articles (Alpaca News API, free)
Stage 4  News Analysis        stage2 + articles →  sentiment per symbol  (LLM × ~10)
Stage 5  Signal Selection     market data + sentiment → direction/confidence (LLM × ~10)
Stage 6  Risk Allocation      signal + portfolio → qty/SL/target           (LLM × ~10)

The full agent orchestrator handles Stages 3-6 internally.
The waterfall only controls which symbols enter the pipeline, minimising LLM calls.

The existing "Run Now" specific-symbol flow (AgentOrchestrator directly) is untouched.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from scanner.screener import MarketScreener, ScreenerResult
from scanner.deep_screener import DeepScreener, DeepScreenResult
from scanner.universe import get_default_universe, get_tech_universe, get_etfs_only
from utils.logger import get_logger

log = get_logger(__name__)

_UNIVERSE_MAP = {
    "tech": get_tech_universe,
    "etfs": get_etfs_only,
}


class WaterfallScanPipeline:
    """
    Three-stage fast filter, then full 6-agent pipeline on survivors only.
    """

    def __init__(self, orchestrator: Any = None) -> None:
        self.stage1 = MarketScreener()
        self.stage2 = DeepScreener()
        self.orchestrator = orchestrator

    def run(
        self,
        universe: list[str] | None = None,
        universe_name: str | None = None,
        stage1_top_n: int = 20,
        stage2_top_n: int = 10,
    ) -> dict:
        if universe is None:
            getter = _UNIVERSE_MAP.get(universe_name or "default", get_default_universe)
            universe = getter()

        started_at = datetime.now(timezone.utc).isoformat()
        log.info(
            "Waterfall scan started — universe=%d, stage1_top_n=%d, stage2_top_n=%d",
            len(universe), stage1_top_n, stage2_top_n,
        )

        # ── Stage 1: Fast indicator screen ────────────────────────────────────
        stage1_results: list[ScreenerResult] = []
        try:
            stage1_results = self.stage1.screen(universe, top_n=stage1_top_n)
            log.info("Stage 1 → %d survivors: %s",
                     len(stage1_results), [r.symbol for r in stage1_results])
        except Exception as exc:
            log.error("Stage 1 screener failed: %s", exc)

        if not stage1_results:
            return self._empty(started_at, len(universe), stage1_top_n, stage2_top_n)

        # ── Stage 2: Deep technical + volume + relative-strength ──────────────
        stage2_results: list[DeepScreenResult] = []
        try:
            stage2_results = self.stage2.screen(stage1_results, top_n=stage2_top_n)
            log.info("Stage 2 → %d survivors: %s",
                     len(stage2_results), [r.symbol for r in stage2_results])
        except Exception as exc:
            log.error("Stage 2 deep screener failed: %s", exc)
            # Fall back: treat stage1 results as stage2 (no deep scoring)
            stage2_results = [
                DeepScreenResult(
                    symbol=sr.symbol,
                    stage1_score=sr.score,
                    deep_score=0,
                    combined_score=sr.score,
                    bb_squeeze=False,
                    volume_surge=False,
                    relative_strength_vs_spy=None,
                    trend_aligned=None,
                    screener_signals=sr.screener_signals,
                )
                for sr in stage1_results[:stage2_top_n]
            ]

        candidate_symbols = [r.symbol for r in stage2_results]

        # ── Stages 3-6: Full agent pipeline (News→Analysis→Signal→Risk) ───────
        agent_status: dict = {}
        if self.orchestrator is not None:
            try:
                _, agent_status = self.orchestrator.run(
                    symbols=candidate_symbols, trigger="scanner"
                )
                log.info("Agent pipeline completed for %d scan candidates", len(candidate_symbols))
            except Exception as exc:
                log.error("Agent pipeline failed during scan: %s", exc)
        else:
            log.warning("Orchestrator unavailable — stages 3-6 skipped")

        # ── Build ranked output ────────────────────────────────────────────────
        ranked = self._build_ranked(stage2_results, agent_status)

        return {
            "status":         "ok",
            "started_at":     started_at,
            "completed_at":   datetime.now(timezone.utc).isoformat(),
            "universe_size":  len(universe),
            "universe_name":  universe_name or "default",
            "stage1_top_n":   stage1_top_n,
            "stage2_top_n":   stage2_top_n,
            "stage1_count":   len(stage1_results),
            "stage2_count":   len(stage2_results),
            "ranked":         ranked,
            "agent_status":   agent_status,
        }

    # ── Ranked output ──────────────────────────────────────────────────────────

    def _build_ranked(
        self,
        stage2_results: list[DeepScreenResult],
        agent_status: dict,
    ) -> list[dict]:
        signal_selections = agent_status.get("signal_selections", {}) or {}
        risk_allocations  = agent_status.get("risk_allocations",  {}) or {}

        rows: list[dict] = []
        for dr in stage2_results:
            sym  = dr.symbol
            sel  = signal_selections.get(sym) or {}
            risk = risk_allocations.get(sym)  or {}

            direction  = str(sel.get("direction",  "NO_TRADE"))
            confidence = float(sel.get("confidence", 0.0) or 0.0)
            reasoning  = str(sel.get("reasoning",  ""))

            approved      = bool(risk.get("approved",       False))
            qty           = risk.get("qty")
            entry_price   = risk.get("entry_price")
            stop_loss     = risk.get("stop_loss")
            profit_target = risk.get("profit_target")
            risk_pct      = risk.get("risk_pct")
            rej_reason    = risk.get("rejection_reason")

            entry = float(entry_price or 0)
            sl    = float(stop_loss   or 0)
            pt    = float(profit_target or 0)
            rr    = None
            if entry > 0 and sl > 0 and abs(entry - sl) > 0:
                rr = round(abs(pt - entry) / abs(entry - sl), 2)

            rows.append({
                "symbol":                  sym,
                # Scores
                "stage1_score":            dr.stage1_score,
                "deep_score":              dr.deep_score,
                "combined_score":          dr.combined_score,
                # Stage 1 info
                "screener_signals":        dr.screener_signals,
                # Stage 2 info
                "deep_signals":            dr.deep_signals,
                "bb_squeeze":              dr.bb_squeeze,
                "volume_surge":            dr.volume_surge,
                "relative_strength_vs_spy": dr.relative_strength_vs_spy,
                "trend_aligned":           dr.trend_aligned,
                # Market data
                "latest_price":            None,   # fetched by agent, not stored in screener
                "ema_crossover":           dr.screener_signals and any(
                    "crossed" in s.lower() for s in dr.screener_signals
                ) or None,
                # Agent outputs
                "direction":               direction,
                "confidence":              confidence,
                "reasoning":               reasoning,
                "risk_approved":           approved,
                "qty":                     qty,
                "entry_price":             entry_price,
                "stop_loss":               stop_loss,
                "profit_target":           profit_target,
                "risk_pct":                risk_pct,
                "rr_ratio":                rr,
                "rejection_reason":        rej_reason,
            })

        # Sort: actionable first → confidence desc → combined_score desc
        rows.sort(key=lambda r: (
            0 if r["direction"] != "NO_TRADE" else 1,
            -(r["confidence"] or 0),
            -(r["combined_score"] or 0),
        ))
        return rows

    @staticmethod
    def _empty(started_at: str, universe_size: int, s1n: int, s2n: int) -> dict:
        return {
            "status":        "ok",
            "started_at":    started_at,
            "completed_at":  datetime.now(timezone.utc).isoformat(),
            "universe_size": universe_size,
            "stage1_top_n":  s1n,
            "stage2_top_n":  s2n,
            "stage1_count":  0,
            "stage2_count":  0,
            "ranked":        [],
            "agent_status":  {},
        }


# Backward-compat alias
ScanPipeline = WaterfallScanPipeline
