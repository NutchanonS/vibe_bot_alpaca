"""Signal selection prompt context builder with news sentiment integration."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agents.base_agent import BaseAgent


@dataclass
class SignalSelectionContext:
    symbol: str
    prompt_context: str
    supporting_signals: list[str] = field(default_factory=list)
    conflicting_signals: list[str] = field(default_factory=list)


class SignalSelectionAgent(BaseAgent):
    """Prepares per-symbol context for downstream LLM signal selection."""

    name = "signal_selection"

    def run(self, state: dict) -> dict:
        news_sentiments = state.get("news_sentiments", {})
        qa_result = state.get("qa_result")
        approved_symbols = self._approved_symbols(qa_result)

        contexts: dict[str, SignalSelectionContext] = {}
        for symbol in approved_symbols:
            sentiment = news_sentiments.get(symbol)
            contexts[symbol] = self._build_context(symbol, sentiment)

        out = dict(state)
        out["signal_contexts"] = contexts
        return out

    def _build_context(self, symbol: str, sentiment: Any) -> SignalSelectionContext:
        if sentiment is None:
            base = (
                f"News sentiment for {symbol}: +0.00 (confidence 0%). "
                "Themes: none. Risks: none."
            )
            return SignalSelectionContext(symbol=symbol, prompt_context=base)

        score = float(getattr(sentiment, "overall_sentiment", 0.0))
        confidence = float(getattr(sentiment, "confidence", 0.0))
        themes = getattr(sentiment, "key_themes", []) or []
        risks = getattr(sentiment, "risk_events", []) or []

        prompt = (
            f"News sentiment for {symbol}: {score:+.2f} "
            f"(confidence {confidence:.0%}). "
            f"Themes: {', '.join(themes) if themes else 'none'}. "
            f"Risks: {', '.join(risks) if risks else 'none'}."
        )

        supporting: list[str] = []
        conflicting: list[str] = []
        if score > 0.5 and confidence > 0.7:
            supporting.append("Strong bullish news sentiment")
        if score < -0.5 and confidence > 0.7:
            conflicting.append("Strong bearish news sentiment")

        return SignalSelectionContext(
            symbol=symbol,
            prompt_context=prompt,
            supporting_signals=supporting,
            conflicting_signals=conflicting,
        )

    @staticmethod
    def _approved_symbols(qa_result: Any) -> list[str]:
        if qa_result is None:
            return []
        if isinstance(qa_result, dict):
            approved = qa_result.get("approved_symbols", [])
        else:
            approved = getattr(qa_result, "approved_symbols", [])
        return [str(sym) for sym in approved]
