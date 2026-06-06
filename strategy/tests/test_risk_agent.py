"""Unit tests for RiskCapitalAllocationAgent with mocked OpenAI responses."""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from agents.market_data_agent import MarketSnapshot
from agents.risk_agent import RiskAllocationModel, RiskCapitalAllocationAgent
from agents.signal_selection_agent import SignalSelectionResult


class _ParseResult:
    def __init__(self, parsed: RiskAllocationModel):
        self.choices = [type("Choice", (), {"message": type("Msg", (), {"parsed": parsed})()})()]


class _MockCompletions:
    def __init__(self, parsed: RiskAllocationModel | None = None, raise_exc: bool = False):
        self._parsed = parsed
        self._raise = raise_exc

    def parse(self, **_kwargs):
        if self._raise:
            raise TimeoutError("mock timeout")
        return _ParseResult(self._parsed)


class _MockClient:
    def __init__(self, parsed: RiskAllocationModel | None = None, raise_exc: bool = False):
        completions = _MockCompletions(parsed=parsed, raise_exc=raise_exc)
        chat = type("Chat", (), {"completions": completions})()
        beta = type("Beta", (), {"chat": chat})()
        self.beta = beta


def _bars(n: int = 40) -> pd.DataFrame:
    closes = [100.0 + i * 0.2 for i in range(n)]
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c + 1.5 for c in closes],
            "low": [c - 1.5 for c in closes],
            "close": closes,
            "volume": [1_000_000] * n,
        }
    )


def _snapshot(symbol: str = "AAPL", price: float = 100.0) -> MarketSnapshot:
    b = _bars()
    b.loc[b.index[-1], "close"] = price
    return MarketSnapshot(
        symbol=symbol,
        timestamp=datetime.now(timezone.utc),
        bars=b,
        indicators={"rsi_14": 50.0, "ema_9": 100.0, "ema_21": 99.0, "vwap": 99.5},
        latest_price=price,
        avg_volume_20=1_000_000.0,
        data_quality_score=1.0,
    )


def _selection(symbol: str = "AAPL", direction: str = "BUY", confidence: float = 0.8) -> SignalSelectionResult:
    return SignalSelectionResult(
        symbol=symbol,
        direction=direction,
        confidence=confidence,
        reasoning="Strong evidence.",
        supporting_signals=["ema_crossover:BUY"],
        conflicting_signals=[],
    )


def _portfolio(equity: float = 100_000.0, cash: float = 50_000.0, positions: list[dict] | None = None) -> dict:
    return {
        "equity": equity,
        "cash": cash,
        "positions": positions or [],
    }


def _alloc_model(qty: int, entry_price: float = 100.0, stop_loss: float = 95.0, target: float = 110.0) -> RiskAllocationModel:
    return RiskAllocationModel(
        symbol="AAPL",
        qty=qty,
        entry_price=entry_price,
        stop_loss=stop_loss,
        profit_target=target,
        risk_pct=1.0,
        reasoning="Model suggests moderate size.",
    )


def test_rejects_no_trade_without_llm_call():
    agent = RiskCapitalAllocationAgent(client=_MockClient(raise_exc=True))
    state = {
        "signal_selections": {"AAPL": _selection(direction="NO_TRADE")},
        "portfolio": _portfolio(),
        "market_snapshots": [_snapshot("AAPL")],
    }

    result = agent.run(state)
    allocation = result["risk_allocations"]["AAPL"]
    assert allocation.approved is False
    assert allocation.rejection_reason is not None


def test_rejects_new_buy_when_open_positions_limit_reached():
    positions = [{"symbol": f"S{i}", "qty": "1"} for i in range(5)]
    agent = RiskCapitalAllocationAgent(client=_MockClient(parsed=_alloc_model(qty=10)))
    state = {
        "signal_selections": {"AAPL": _selection(direction="BUY")},
        "portfolio": _portfolio(positions=positions),
        "market_snapshots": [_snapshot("AAPL")],
    }

    result = agent.run(state)
    allocation = result["risk_allocations"]["AAPL"]
    assert allocation.approved is False
    assert "positions limit" in allocation.rejection_reason


def test_caps_qty_to_max_position_pct():
    # equity 100k, price 100 => 5% cap = 50 shares
    agent = RiskCapitalAllocationAgent(client=_MockClient(parsed=_alloc_model(qty=80, entry_price=100.0, stop_loss=98.0)))
    state = {
        "signal_selections": {"AAPL": _selection(direction="BUY")},
        "portfolio": _portfolio(),
        "market_snapshots": [_snapshot("AAPL", price=100.0)],
    }

    result = agent.run(state)
    allocation = result["risk_allocations"]["AAPL"]
    assert allocation.approved is True
    assert allocation.qty == 50


def test_caps_add_qty_to_two_percent_when_already_holding():
    # equity 100k, price 100 => add cap 2% = 20 shares
    positions = [{"symbol": "AAPL", "qty": "30"}]
    agent = RiskCapitalAllocationAgent(client=_MockClient(parsed=_alloc_model(qty=35, entry_price=100.0, stop_loss=99.0)))
    state = {
        "signal_selections": {"AAPL": _selection(direction="BUY")},
        "portfolio": _portfolio(positions=positions),
        "market_snapshots": [_snapshot("AAPL", price=100.0)],
    }

    result = agent.run(state)
    allocation = result["risk_allocations"]["AAPL"]
    assert allocation.approved is True
    assert allocation.qty == 20


def test_caps_qty_by_single_trade_risk_limit():
    # equity 100k, price 100 => position cap 50 shares.
    # risk budget = 1.5% = 1,500; risk/share = 40 => risk cap = 37 shares (binding cap).
    agent = RiskCapitalAllocationAgent(client=_MockClient(parsed=_alloc_model(qty=50, entry_price=100.0, stop_loss=60.0)))
    state = {
        "signal_selections": {"AAPL": _selection(direction="BUY")},
        "portfolio": _portfolio(),
        "market_snapshots": [_snapshot("AAPL", price=100.0)],
    }

    result = agent.run(state)
    allocation = result["risk_allocations"]["AAPL"]
    assert allocation.approved is True
    assert allocation.qty == 37


def test_openai_failure_falls_back_to_rejection():
    agent = RiskCapitalAllocationAgent(client=_MockClient(raise_exc=True))
    state = {
        "signal_selections": {"AAPL": _selection(direction="BUY")},
        "portfolio": _portfolio(),
        "market_snapshots": [_snapshot("AAPL")],
    }

    result = agent.run(state)
    allocation = result["risk_allocations"]["AAPL"]
    assert allocation.approved is False
    assert "OpenAI" in allocation.rejection_reason
