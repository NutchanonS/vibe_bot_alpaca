"""Signal selection agent — LLM-powered trade decision using rule-based signals as evidence."""

from __future__ import annotations

from typing import Any, Literal

import pandas as pd
from pydantic import BaseModel, Field

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

CONFIDENCE_THRESHOLD = 0.65

# Kept constant (no dynamic data) so OpenAI's automatic prompt caching applies.
SYSTEM_PROMPT = (
    "You are a disciplined quantitative trading assistant. "
    "You receive technical indicators, rule-based strategy signals, and news sentiment for a stock. "
    "Decide BUY, SELL, or NO_TRADE based on signal confluence. "
    "Only recommend BUY or SELL when multiple independent signals agree strongly. "
    "Default to NO_TRADE when signals conflict or evidence is weak. "
    "Confidence (0.0–1.0) reflects how strongly the evidence supports the direction. "
    "Keep reasoning to 2–3 sentences maximum."
)


class SignalSelectionResult(BaseModel):
    symbol: str
    direction: Literal["BUY", "SELL", "NO_TRADE"]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    supporting_signals: list[str]
    conflicting_signals: list[str]


class SignalSelectionAgent(BaseAgent):
    """Runs rule-based strategies as evidence, then calls gpt-4o-mini to decide BUY/SELL/NO_TRADE."""

    name = "signal_selection"

    def __init__(
        self,
        client: Any = None,
        model: str = "gpt-4o-mini",
        strategies: list[Any] | None = None,
    ) -> None:
        self.model = model
        self.client = client or self._build_client()
        # Accept injected strategies so tests can pass [] to avoid heavy indicator imports.
        self._strategies = strategies if strategies is not None else self._init_strategies()

    # ── BaseAgent contract ────────────────────────────────────────────────────

    def run(self, state: dict) -> dict:
        snapshots = state.get("market_snapshots", [])
        qa_result = state.get("qa_result")
        news_sentiments = state.get("news_sentiments", {})
        approved = self._approved_symbols(qa_result)

        by_symbol = {self._snap_symbol(s): s for s in snapshots if self._snap_symbol(s)}

        selections: dict[str, SignalSelectionResult] = {}
        for symbol in approved:
            snapshot = by_symbol.get(symbol)
            if snapshot is None:
                selections[symbol] = self._no_trade(symbol, "No market snapshot available.")
                continue
            sentiment = news_sentiments.get(symbol)
            try:
                selections[symbol] = self._select(symbol, snapshot, sentiment)
            except Exception as exc:
                log.error("SignalSelectionAgent failed for %s: %s", symbol, exc)
                selections[symbol] = self._no_trade(symbol, "Agent error; defaulting NO_TRADE.")

        out = dict(state)
        out["signal_selections"] = selections
        return out

    # ── Core selection logic ──────────────────────────────────────────────────

    def _select(self, symbol: str, snapshot: Any, sentiment: Any) -> SignalSelectionResult:
        bars = self._get_bars(snapshot)
        signals = self._run_strategies(symbol, bars)
        prompt = self._build_user_prompt(symbol, snapshot, signals, sentiment)

        if not self.client:
            return self._no_trade(symbol, "OpenAI client unavailable.")

        result = self.client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            response_format=SignalSelectionResult,
        )
        parsed = result.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("No parsed result from OpenAI")

        # Confidence gate: override LLM direction if below threshold
        if parsed.confidence < CONFIDENCE_THRESHOLD:
            parsed.direction = "NO_TRADE"

        return parsed

    def _run_strategies(self, symbol: str, bars: pd.DataFrame) -> list[Any]:
        signals = []
        for strat in self._strategies:
            try:
                signals.append(strat.run(symbol, bars))
            except Exception as exc:
                log.warning("Strategy %s failed for %s: %s", strat.name, symbol, exc)
        return signals

    # ── Prompt builder ────────────────────────────────────────────────────────

    @staticmethod
    def _build_user_prompt(symbol: str, snapshot: Any, signals: list[Any], sentiment: Any) -> str:
        ind = getattr(snapshot, "indicators", {}) or {}
        price = float(getattr(snapshot, "latest_price", 0.0))

        rsi = ind.get("rsi_14")
        ema9 = ind.get("ema_9")
        ema21 = ind.get("ema_21")
        vwap = ind.get("vwap")

        rsi_str = f"{rsi:.1f}" if rsi is not None else "N/A"

        if ema9 is not None and ema21 is not None:
            ema_rel = (
                f"EMA9={ema9:.2f} {'above' if ema9 > ema21 else 'below'} EMA21={ema21:.2f}"
            )
        else:
            ema_rel = "N/A"

        if vwap is not None:
            vwap_rel = f"${price:.2f} {'above' if price > vwap else 'below'} VWAP=${vwap:.2f}"
        else:
            vwap_rel = "N/A"

        # 5-bar close momentum
        bars = getattr(snapshot, "bars", None)
        momentum_str = "N/A"
        if bars is not None and hasattr(bars, "iloc") and len(bars) >= 5:
            try:
                closes = bars["close"].iloc[-5:].astype(float).values
                momentum = (closes[-1] - closes[0]) / closes[0] * 100
                momentum_str = f"{momentum:+.2f}% over last 5 bars"
            except Exception:
                pass

        # Rule-based strategy signals
        sig_lines: list[str] = []
        for sig in signals:
            direction = getattr(sig.signal, "value", str(sig.signal)).upper()
            strength = getattr(sig, "strength", 1.0)
            sig_lines.append(f"  {sig.strategy}: {direction} (strength={strength:.2f})")

        # News sentiment
        if sentiment is not None:
            score = float(getattr(sentiment, "overall_sentiment", 0.0))
            conf = float(getattr(sentiment, "confidence", 0.0))
            sentiment_line = f"News sentiment: {score:+.2f} ({conf:.0%} confidence)"
        else:
            sentiment_line = "News sentiment: no data"

        lines = [
            f"Symbol: {symbol}",
            f"Price: ${price:.2f}",
            f"RSI(14): {rsi_str}",
            f"EMA: {ema_rel}",
            f"VWAP: {vwap_rel}",
            f"5-bar momentum: {momentum_str}",
            "Strategy signals:",
            *sig_lines,
            sentiment_line,
        ]
        return "\n".join(lines)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _no_trade(symbol: str, reason: str) -> SignalSelectionResult:
        return SignalSelectionResult(
            symbol=symbol,
            direction="NO_TRADE",
            confidence=0.0,
            reasoning=reason,
            supporting_signals=[],
            conflicting_signals=[],
        )

    @staticmethod
    def _init_strategies() -> list[Any]:
        from strategies.ema_crossover import EMACrossover
        from strategies.rsi_mean_reversion import RSIMeanReversion
        from strategies.vwap_breakout import VWAPBreakout

        return [RSIMeanReversion(symbols=[]), EMACrossover(symbols=[]), VWAPBreakout(symbols=[])]

    @staticmethod
    def _approved_symbols(qa_result: Any) -> list[str]:
        if qa_result is None:
            return []
        if isinstance(qa_result, dict):
            approved = qa_result.get("approved_symbols", [])
        else:
            approved = getattr(qa_result, "approved_symbols", [])
        return [str(sym) for sym in approved]

    @staticmethod
    def _snap_symbol(snapshot: Any) -> str:
        if snapshot is None:
            return ""
        if isinstance(snapshot, dict):
            return str(snapshot.get("symbol", ""))
        return str(getattr(snapshot, "symbol", ""))

    @staticmethod
    def _get_bars(snapshot: Any) -> pd.DataFrame:
        if snapshot is None:
            return pd.DataFrame()
        if isinstance(snapshot, dict):
            return snapshot.get("bars", pd.DataFrame())
        return getattr(snapshot, "bars", pd.DataFrame())

    @staticmethod
    def _build_client() -> Any:
        if not settings.openai_api_key:
            return None
        try:
            from openai import OpenAI

            return OpenAI(api_key=settings.openai_api_key)
        except Exception as exc:
            log.error("Failed to initialize OpenAI client: %s", exc)
            return None
