"""Catalyst Classifier Agent (Stage 4) — classifies and qualifies the event
driving a high-momentum move.

Input  : news articles (last 1–4 h) + price move % + RVOL per symbol
Output : CatalystResult per symbol — type, quality, risk flags, sustainability
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

CatalystType    = Literal["earnings", "fda", "contract", "squeeze", "macro", "legal", "none", "unknown"]
CatalystQuality = Literal["strong", "moderate", "weak", "unknown"]

SYSTEM_PROMPT = (
    "You are a professional momentum trader analyzing why a stock is moving sharply today. "
    "Given recent news headlines, the percentage price move, and the relative volume, "
    "classify the catalyst driving the move. Be precise and conservative. "
    "If no clear catalyst is found, say 'none' not 'unknown'."
)


class CatalystResult(BaseModel):
    symbol:            str
    catalyst_type:     CatalystType     = "unknown"
    catalyst_quality:  CatalystQuality  = "unknown"
    is_sustainable:    bool             = False
    risk_flags:        list[str]        = Field(default_factory=list)
    key_headlines:     list[str]        = Field(default_factory=list)
    summary:           str              = ""
    confidence:        float            = Field(ge=0.0, le=1.0, default=0.0)
    analysis_status:   str              = "ok"


class CatalystClassifierAgent(BaseAgent):
    """LLM agent that identifies and rates the catalyst behind a momentum move."""

    name = "catalyst_classifier"

    def __init__(self, client: Any = None, model: str = "gpt-4o-mini") -> None:
        self.model  = model
        self.client = client or self._build_client()

    # ── BaseAgent contract ────────────────────────────────────────────────────

    def run(self, state: dict) -> dict:
        stage2_results  = state.get("momentum_stage2", [])
        news_snapshots  = state.get("momentum_news_snapshots", [])

        by_symbol: dict[str, list[dict]] = {}
        for snap in news_snapshots:
            sym = snap.get("symbol", "") if isinstance(snap, dict) else getattr(snap, "symbol", "")
            articles = snap.get("articles", []) if isinstance(snap, dict) else getattr(snap, "articles", [])
            by_symbol[sym] = [self._article_to_dict(a) for a in articles]

        catalysts: dict[str, CatalystResult] = {}
        for sr in stage2_results:
            symbol = getattr(sr, "symbol", None) or (sr.get("symbol", "") if isinstance(sr, dict) else "")
            if not symbol:
                continue

            articles   = by_symbol.get(symbol, [])
            change_pct = getattr(sr, "change_pct", None) if not isinstance(sr, dict) else sr.get("change_pct", 0)
            rvol       = getattr(sr, "rvol",        None) if not isinstance(sr, dict) else sr.get("rvol",        0)

            if not self.client:
                catalysts[symbol] = CatalystResult(
                    symbol=symbol,
                    analysis_status="no_llm",
                    catalyst_type="unknown",
                    catalyst_quality="unknown",
                    summary="OpenAI client unavailable.",
                )
                continue

            try:
                catalysts[symbol] = self._classify(symbol, articles, float(change_pct), float(rvol))
            except Exception as exc:
                log.error("CatalystClassifierAgent failed for %s: %s", symbol, exc)
                catalysts[symbol] = CatalystResult(
                    symbol=symbol,
                    analysis_status="openai_failed",
                    summary=f"LLM call failed: {exc}",
                )

        out = dict(state)
        out["catalyst_results"] = catalysts
        return out

    # ── LLM call ─────────────────────────────────────────────────────────────

    def _classify(
        self,
        symbol:     str,
        articles:   list[dict],
        change_pct: float,
        rvol:       float,
    ) -> CatalystResult:
        headline_lines: list[str] = []
        for i, a in enumerate(articles[:10], 1):
            headline = str(a.get("headline", "")).strip()[:200]
            source   = str(a.get("source", "")).strip()
            created  = str(a.get("created_at", "")).strip()[:16]
            headline_lines.append(f"{i}. [{source} {created}] {headline}")

        headlines_text = "\n".join(headline_lines) if headline_lines else "No news found."

        user_prompt = (
            f"Symbol: {symbol}\n"
            f"Today's move: +{change_pct:.1f}%\n"
            f"Relative Volume: {rvol:.1f}×\n\n"
            f"Recent news (last 1-4 hours):\n{headlines_text}\n\n"
            "Classify this move:\n"
            "- catalyst_type: earnings | fda | contract | squeeze | macro | legal | none | unknown\n"
            "- catalyst_quality: strong | moderate | weak | unknown\n"
            "- is_sustainable: true if the catalyst supports continued momentum today\n"
            "- risk_flags: e.g. 'halt_risk', 'thin_float', 'pr_pump', 'no_news_catalyst'\n"
            "- key_headlines: the 1-3 most relevant headlines (exact text)\n"
            "- summary: 1-2 sentence plain-English explanation of the move\n"
            "- confidence: 0.0-1.0 in your classification\n"
        )

        result = self.client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
            response_format=CatalystResult,
        )
        parsed = result.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("No parsed catalyst result")
        parsed.symbol = symbol
        return parsed

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _article_to_dict(article: Any) -> dict:
        if isinstance(article, dict):
            return article
        return {
            "headline":   getattr(article, "headline",   ""),
            "summary":    getattr(article, "summary",    ""),
            "source":     getattr(article, "source",     ""),
            "created_at": str(getattr(article, "created_at", "")),
        }

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
