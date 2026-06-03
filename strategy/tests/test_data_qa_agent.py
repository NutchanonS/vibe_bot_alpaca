"""Unit tests for DataQAAgent (Step 2)."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
import pytest

from agents.data_qa_agent import DataQAAgent, QAResult
from agents.market_data_agent import MarketSnapshot


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_bars(n: int, all_nan_col: bool = False) -> pd.DataFrame:
    np.random.seed(42)
    close = 100 + np.cumsum(np.random.randn(n) * 0.3)
    df = pd.DataFrame({
        "timestamp": pd.date_range("2026-01-01", periods=n, freq="15min", tz="UTC"),
        "open":      close + np.random.randn(n) * 0.05,
        "high":      close + np.abs(np.random.randn(n) * 0.2),
        "low":       close - np.abs(np.random.randn(n) * 0.2),
        "close":     close,
        "volume":    np.random.randint(100_000, 900_000, n).astype(float),
    })
    if all_nan_col:
        df["bad_col"] = float("nan")
    return df


def _snap(
    symbol: str = "AAPL",
    price: float = 150.0,
    quality: float = 1.0,
    age_minutes: float = 0.0,
    all_nan_col: bool = False,
) -> MarketSnapshot:
    ts = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
    return MarketSnapshot(
        symbol=symbol,
        timestamp=ts,
        bars=_make_bars(50, all_nan_col=all_nan_col),
        indicators={"rsi_14": 45.0, "ema_9": 149.0, "ema_21": 148.0, "vwap": 150.5},
        latest_price=price,
        avg_volume_20=300_000.0,
        data_quality_score=quality,
    )


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestDataQAAgent:
    agent = DataQAAgent()

    def test_healthy_snapshot_is_approved(self):
        result = self.agent.run({"market_snapshots": [_snap("SPY")]})
        qa: QAResult = result["qa_result"]
        assert "SPY" in qa.approved_symbols
        assert qa.blocked_symbols == []
        assert qa.circuit_break is False

    def test_zero_price_blocks(self):
        result = self.agent.run({"market_snapshots": [_snap("AAPL", price=0.0)]})
        qa: QAResult = result["qa_result"]
        assert "AAPL" in qa.blocked_symbols
        assert "AAPL" not in qa.approved_symbols

    def test_negative_price_blocks(self):
        result = self.agent.run({"market_snapshots": [_snap("TSLA", price=-5.0)]})
        qa: QAResult = result["qa_result"]
        assert "TSLA" in qa.blocked_symbols

    def test_stale_data_blocks(self):
        result = self.agent.run({"market_snapshots": [_snap("NVDA", age_minutes=25)]})
        qa: QAResult = result["qa_result"]
        assert "NVDA" in qa.blocked_symbols

    def test_fresh_data_within_window_passes(self):
        result = self.agent.run({"market_snapshots": [_snap("QQQ", age_minutes=10)]})
        qa: QAResult = result["qa_result"]
        assert "QQQ" in qa.approved_symbols

    def test_all_nan_column_blocks(self):
        result = self.agent.run({"market_snapshots": [_snap("MSFT", all_nan_col=True)]})
        qa: QAResult = result["qa_result"]
        assert "MSFT" in qa.blocked_symbols

    def test_low_quality_goes_to_degraded(self):
        result = self.agent.run({"market_snapshots": [_snap("AMD", quality=0.5)]})
        qa: QAResult = result["qa_result"]
        assert "AMD" in qa.degraded_symbols
        assert "AMD" not in qa.approved_symbols
        assert "AMD" not in qa.blocked_symbols

    def test_circuit_break_when_majority_blocked(self):
        snapshots = [
            _snap("A", price=0.0),   # blocked
            _snap("B", price=0.0),   # blocked
            _snap("C", price=0.0),   # blocked
            _snap("D"),              # approved
        ]
        result = self.agent.run({"market_snapshots": snapshots})
        qa: QAResult = result["qa_result"]
        assert qa.circuit_break is True

    def test_no_circuit_break_when_minority_blocked(self):
        snapshots = [
            _snap("A", price=0.0),   # blocked
            _snap("B"),              # approved
            _snap("C"),              # approved
            _snap("D"),              # approved
        ]
        result = self.agent.run({"market_snapshots": snapshots})
        qa: QAResult = result["qa_result"]
        assert qa.circuit_break is False

    def test_empty_input_returns_no_circuit_break(self):
        result = self.agent.run({"market_snapshots": []})
        qa: QAResult = result["qa_result"]
        assert qa.circuit_break is False
        assert qa.approved_symbols == []

    def test_state_pass_through(self):
        """Agent must not drop existing state keys."""
        state = {"market_snapshots": [_snap()], "symbols": ["SPY"], "extra": 42}
        result = self.agent.run(state)
        assert result["symbols"] == ["SPY"]
        assert result["extra"] == 42
        assert "qa_result" in result

    def test_report_is_non_empty_string(self):
        result = self.agent.run({"market_snapshots": [_snap()]})
        assert isinstance(result["qa_result"].report, str)
        assert len(result["qa_result"].report) > 0
