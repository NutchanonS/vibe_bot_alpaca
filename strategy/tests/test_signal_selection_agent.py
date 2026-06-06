"""Unit tests for SignalSelectionAgent with mocked OpenAI responses."""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from agents.data_qa_agent import QAResult
from agents.market_data_agent import MarketSnapshot
from agents.signal_selection_agent import SignalSelectionAgent, SignalSelectionResult

# ── Mock OpenAI client helpers ────────────────────────────────────────────────

class _ParseResult:
    def __init__(self, parsed: SignalSelectionResult):
        self.choices = [type("Choice", (), {"message": type("Msg", (), {"parsed": parsed})()})()]


class _MockCompletions:
    def __init__(self, parsed: SignalSelectionResult | None = None, raise_exc: bool = False):
        self._parsed = parsed
        self._raise = raise_exc

    def parse(self, **_kwargs):
        if self._raise:
            raise TimeoutError("mock timeout")
        return _ParseResult(self._parsed)


class _MockClient:
    def __init__(self, parsed: SignalSelectionResult | None = None, raise_exc: bool = False):
        completions = _MockCompletions(parsed=parsed, raise_exc=raise_exc)
        chat = type("Chat", (), {"completions": completions})()
        beta = type("Beta", (), {"chat": chat})()
        self.beta = beta


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _make_bars(n: int = 40) -> pd.DataFrame:
    """Minimal OHLCV DataFrame with enough bars for all three strategies."""
    closes = [100.0 + i * 0.5 for i in range(n)]
    return pd.DataFrame({
        "open":   closes,
        "high":   [c + 1.0 for c in closes],
        "low":    [c - 1.0 for c in closes],
        "close":  closes,
        "volume": [1_000_000] * n,
    })


def _make_snapshot(symbol: str = "AAPL", bars: pd.DataFrame | None = None) -> MarketSnapshot:
    b = bars if bars is not None else _make_bars()
    return MarketSnapshot(
        symbol=symbol,
        timestamp=datetime.now(timezone.utc),
        bars=b,
        indicators={"rsi_14": 45.0, "ema_9": 105.0, "ema_21": 103.0, "vwap": 102.0},
        latest_price=106.0,
        avg_volume_20=1_000_000.0,
        data_quality_score=1.0,
    )


def _make_result(
    symbol: str = "AAPL",
    direction: str = "BUY",
    confidence: float = 0.80,
) -> SignalSelectionResult:
    return SignalSelectionResult(
        symbol=symbol,
        direction=direction,
        confidence=confidence,
        reasoning="RSI and EMA signals align bullishly.",
        supporting_signals=["rsi_mean_reversion: BUY", "ema_crossover: BUY"],
        conflicting_signals=[],
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_selects_buy_for_approved_symbol():
    agent = SignalSelectionAgent(client=_MockClient(parsed=_make_result(direction="BUY", confidence=0.80)), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    assert "signal_selections" in result
    sel = result["signal_selections"]["AAPL"]
    assert sel.direction == "BUY"
    assert sel.confidence == 0.80


def test_forces_no_trade_when_confidence_below_threshold():
    # LLM returns BUY with confidence 0.50 — should be overridden to NO_TRADE
    agent = SignalSelectionAgent(client=_MockClient(parsed=_make_result(direction="BUY", confidence=0.50)), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    sel = result["signal_selections"]["AAPL"]
    assert sel.direction == "NO_TRADE"
    assert sel.confidence == 0.50  # confidence preserved; only direction is overridden


def test_confidence_exactly_at_threshold_is_kept():
    agent = SignalSelectionAgent(client=_MockClient(parsed=_make_result(direction="SELL", confidence=0.65)), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    sel = result["signal_selections"]["AAPL"]
    assert sel.direction == "SELL"


def test_no_trade_when_snapshot_missing():
    agent = SignalSelectionAgent(client=_MockClient(parsed=_make_result()), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [],  # no snapshot for AAPL
        "news_sentiments": {},
    }
    result = agent.run(state)

    sel = result["signal_selections"]["AAPL"]
    assert sel.direction == "NO_TRADE"
    assert sel.confidence == 0.0


def test_openai_failure_falls_back_to_no_trade():
    agent = SignalSelectionAgent(client=_MockClient(raise_exc=True), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    sel = result["signal_selections"]["AAPL"]
    assert sel.direction == "NO_TRADE"
    assert sel.confidence == 0.0


def test_skips_symbols_not_in_approved_list():
    agent = SignalSelectionAgent(client=_MockClient(parsed=_make_result(symbol="AAPL")), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL"), _make_snapshot("TSLA")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    assert "AAPL" in result["signal_selections"]
    assert "TSLA" not in result["signal_selections"]


def test_multiple_symbols_all_selected():
    call_count = {"n": 0}
    results = [
        _make_result(symbol="AAPL", direction="BUY", confidence=0.75),
        _make_result(symbol="SPY",  direction="BUY", confidence=0.75),
    ]

    class _SeqCompletions:
        def parse(self, **_kwargs):
            r = results[call_count["n"]]
            call_count["n"] += 1
            return _ParseResult(r)

    seq_client = type("C", (), {
        "beta": type("B", (), {
            "chat": type("Ch", (), {"completions": _SeqCompletions()})()
        })()
    })()

    agent = SignalSelectionAgent(client=seq_client, strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL", "SPY"]),
        "market_snapshots": [_make_snapshot("AAPL"), _make_snapshot("SPY")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    assert set(result["signal_selections"].keys()) == {"AAPL", "SPY"}
    assert result["signal_selections"]["AAPL"].direction == "BUY"
    assert result["signal_selections"]["SPY"].direction == "BUY"


def test_no_trade_when_no_approved_symbols():
    agent = SignalSelectionAgent(client=_MockClient(parsed=_make_result()), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=[]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {},
    }
    result = agent.run(state)

    assert result["signal_selections"] == {}


def test_news_sentiment_included_in_prompt(monkeypatch):
    """Verify the user prompt contains the news sentiment line."""
    captured_prompts: list[str] = []

    class _CapturingCompletions:
        def parse(self, **kwargs):
            for msg in kwargs.get("messages", []):
                if msg["role"] == "user":
                    captured_prompts.append(msg["content"])
            return _ParseResult(_make_result())

    class _CapturingClient:
        class _Beta:
            class _Chat:
                completions = _CapturingCompletions()
            chat = _Chat()
        beta = _Beta()

    from agents.news_analysis_agent import NewsSentiment
    sentiment = NewsSentiment(
        symbol="AAPL",
        overall_sentiment=0.72,
        confidence=0.88,
        key_themes=["earnings beat"],
        risk_events=[],
        bullish_reasons=["strong guidance"],
        bearish_reasons=[],
        articles_analyzed=3,
        summary="Positive.",
    )
    agent = SignalSelectionAgent(client=_CapturingClient(), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {"AAPL": sentiment},
    }
    agent.run(state)

    assert captured_prompts, "No user prompt was captured"
    assert "News sentiment: +0.72" in captured_prompts[0]
    assert "88%" in captured_prompts[0]


def test_user_prompt_contains_indicator_values():
    """Verify indicator values from the snapshot appear in the prompt."""
    captured_prompts: list[str] = []

    class _CapturingCompletions:
        def parse(self, **kwargs):
            for msg in kwargs.get("messages", []):
                if msg["role"] == "user":
                    captured_prompts.append(msg["content"])
            return _ParseResult(_make_result())

    class _CapturingClient:
        class _Beta:
            class _Chat:
                completions = _CapturingCompletions()
            chat = _Chat()
        beta = _Beta()

    agent = SignalSelectionAgent(client=_CapturingClient(), strategies=[])
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "market_snapshots": [_make_snapshot("AAPL")],
        "news_sentiments": {},
    }
    agent.run(state)

    prompt = captured_prompts[0]
    assert "RSI(14): 45.0" in prompt
    assert "EMA9=105.00" in prompt
    assert "VWAP" in prompt
    assert "5-bar momentum" in prompt
