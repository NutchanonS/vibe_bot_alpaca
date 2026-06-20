"""Momentum Signal Agent (Stage 5) — generates intraday entry/exit plan.

Unlike SignalSelectionAgent (which focuses on multi-day directional calls),
this agent is built for same-session momentum trades:
  • Entry zone (not a single price — momentum entries require range flexibility)
  • Two profit targets (T1 = 1:1 R to scale out, T2 = 2:1 R to run)
  • Time-based max hold (momentum fades; hard exit prevents overnight exposure)
  • Position size 1–3 % of equity (volatility-adjusted, smaller than normal)
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

Direction = Literal["BUY", "SHORT", "NO_TRADE"]

SYSTEM_PROMPT = (
    "You are an experienced intraday momentum trader. Given price structure data, "
    "a catalyst classification, and volume metrics, produce a precise intraday trade plan. "
    "Be conservative with position sizing on volatile momentum stocks. "
    "All prices must be realistic relative to the current price."
)


class MomentumSignal(BaseModel):
    symbol:            str
    direction:         Direction    = "NO_TRADE"
    entry_zone_low:    float        = Field(ge=0, default=0.0)
    entry_zone_high:   float        = Field(ge=0, default=0.0)
    stop_loss:         float        = Field(ge=0, default=0.0)
    target_1:          float        = Field(ge=0, default=0.0)   # 1:1 R — scale out 50%
    target_2:          float        = Field(ge=0, default=0.0)   # 2:1 R — scale out rest
    hold_minutes:      int          = Field(ge=0, default=60)    # max hold time in minutes
    position_size_pct: float        = Field(ge=0.5, le=5.0, default=1.0)
    confidence:        float        = Field(ge=0.0, le=1.0, default=0.0)
    reasoning:         str          = ""
    risk_reward:       float        = Field(ge=0, default=0.0)
    analysis_status:   str          = "ok"


class MomentumSignalAgent(BaseAgent):
    """LLM agent that produces an intraday momentum entry/exit plan."""

    name = "momentum_signal"

    # Direction is forced to NO_TRADE below this threshold
    MIN_CONFIDENCE = 0.60

    def __init__(self, client: Any = None, model: str = "gpt-4o-mini") -> None:
        self.model  = model
        self.client = client or self._build_client()

    # ── BaseAgent contract ────────────────────────────────────────────────────

    def run(self, state: dict) -> dict:
        stage2_results   = state.get("momentum_stage2", [])
        catalyst_results = state.get("catalyst_results", {})

        signals: dict[str, MomentumSignal] = {}
        for sr in stage2_results:
            symbol = getattr(sr, "symbol", None) or (sr.get("symbol", "") if isinstance(sr, dict) else "")
            if not symbol:
                continue

            catalyst = catalyst_results.get(symbol)

            # Drop weak / no-catalyst stocks (hard gate)
            if catalyst:
                quality = getattr(catalyst, "catalyst_quality", None) or \
                          (catalyst.get("catalyst_quality") if isinstance(catalyst, dict) else None)
                if quality == "weak":
                    signals[symbol] = MomentumSignal(
                        symbol=symbol,
                        direction="NO_TRADE",
                        analysis_status="weak_catalyst",
                        reasoning="Catalyst quality rated weak — skipped.",
                    )
                    continue

            if not self.client:
                signals[symbol] = MomentumSignal(
                    symbol=symbol,
                    analysis_status="no_llm",
                    reasoning="OpenAI client unavailable.",
                )
                continue

            try:
                signals[symbol] = self._plan(sr, catalyst)
            except Exception as exc:
                log.error("MomentumSignalAgent failed for %s: %s", symbol, exc)
                signals[symbol] = MomentumSignal(
                    symbol=symbol,
                    analysis_status="openai_failed",
                    reasoning=str(exc),
                )

        out = dict(state)
        out["momentum_signals"] = signals
        return out

    # ── LLM call ─────────────────────────────────────────────────────────────

    def _plan(self, sr: Any, catalyst: Any) -> MomentumSignal:
        symbol      = getattr(sr, "symbol", "")
        price       = getattr(sr, "latest_price", 0) or 0
        change_pct  = getattr(sr, "change_pct",   0) or 0
        rvol        = getattr(sr, "rvol",          0) or 0
        day_high    = getattr(sr, "day_high",   None)
        vwap        = getattr(sr, "vwap",       None)
        hod_hold    = getattr(sr, "hod_hold",  False)
        flag        = getattr(sr, "flag_pattern", False)
        vwap_reclaim = getattr(sr, "vwap_reclaim", False)
        stage1_sigs = getattr(sr, "stage1_signals", [])
        deep_sigs   = getattr(sr, "deep_signals",   [])

        cat_type    = ""
        cat_quality = ""
        cat_summary = ""
        risk_flags  = []
        if catalyst is not None:
            cat_type    = getattr(catalyst, "catalyst_type",    "") or \
                          (catalyst.get("catalyst_type",    "") if isinstance(catalyst, dict) else "")
            cat_quality = getattr(catalyst, "catalyst_quality", "") or \
                          (catalyst.get("catalyst_quality", "") if isinstance(catalyst, dict) else "")
            cat_summary = getattr(catalyst, "summary",          "") or \
                          (catalyst.get("summary",          "") if isinstance(catalyst, dict) else "")
            risk_flags  = getattr(catalyst, "risk_flags",      []) or \
                          (catalyst.get("risk_flags",      []) if isinstance(catalyst, dict) else [])

        signals_text = ", ".join(stage1_sigs + deep_sigs) or "none"

        user_prompt = (
            f"Symbol: {symbol}\n"
            f"Current price: ${price:.2f}\n"
            f"Today's gain: +{change_pct:.1f}%\n"
            f"RVOL: {rvol:.1f}×\n"
            f"Day high: {f'${day_high:.2f}' if day_high else 'N/A'}\n"
            f"VWAP: {f'${vwap:.2f}' if vwap else 'N/A'}\n"
            f"HOD hold: {hod_hold}  |  Flag pattern: {flag}  |  VWAP reclaim: {vwap_reclaim}\n"
            f"Technical signals: {signals_text}\n\n"
            f"Catalyst type: {cat_type or 'unknown'}\n"
            f"Catalyst quality: {cat_quality or 'unknown'}\n"
            f"Catalyst summary: {cat_summary or 'N/A'}\n"
            f"Risk flags: {', '.join(risk_flags) if risk_flags else 'none'}\n\n"
            "Produce an INTRADAY momentum trade plan:\n"
            "- direction: BUY | SHORT | NO_TRADE\n"
            "- entry_zone_low / entry_zone_high: range where you would enter\n"
            "- stop_loss: price to exit if trade goes wrong (hard stop)\n"
            "- target_1: 1:1 reward-risk price (scale out 50% here)\n"
            "- target_2: 2:1 reward-risk price (exit remaining here)\n"
            "- hold_minutes: max time to hold before forced exit (20-90 min)\n"
            "- position_size_pct: 0.5–3.0% of account equity (smaller for higher RVOL)\n"
            "- confidence: 0.0–1.0 in this setup\n"
            "- reasoning: 1-2 sentences explaining the entry logic and risk\n"
        )

        result = self.client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
            response_format=MomentumSignal,
        )
        parsed = result.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("No parsed momentum signal")
        parsed.symbol = symbol

        # Confidence gate
        if parsed.confidence < self.MIN_CONFIDENCE:
            parsed.direction = "NO_TRADE"
            parsed.analysis_status = "low_confidence"

        # Compute R:R for the dashboard
        entry_mid = (parsed.entry_zone_low + parsed.entry_zone_high) / 2
        risk      = abs(entry_mid - parsed.stop_loss)
        reward    = abs(parsed.target_2 - entry_mid)
        if risk > 0:
            parsed.risk_reward = round(reward / risk, 2)

        return parsed

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _build_client() -> Any:
        if not settings.openai_api_key:
            return None
        try:
            from openai import OpenAI
            return OpenAI(api_key=settings.openai_api_key)
        except Exception as exc:
            log.error("Failed to init OpenAI client: %s", exc)
            return None
