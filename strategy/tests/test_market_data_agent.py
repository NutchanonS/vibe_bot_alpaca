"""Unit tests for MarketDataFetcherAgent using mock client data."""

from __future__ import annotations

import numpy as np
import pandas as pd

from agents.market_data_agent import MarketDataFetcherAgent, MarketSnapshot


def _make_bars(n: int) -> pd.DataFrame:
    np.random.seed(7)
    close = 100 + np.cumsum(np.random.randn(n) * 0.4)
    high = close + np.abs(np.random.randn(n) * 0.2)
    low = close - np.abs(np.random.randn(n) * 0.2)
    open_ = close + np.random.randn(n) * 0.05
    volume = np.random.randint(100_000, 900_000, size=n).astype(float)
    ts = pd.date_range("2026-01-01", periods=n, freq="15min", tz="UTC")

    return pd.DataFrame(
        {
            "timestamp": ts,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


class MockAlpacaClient:
    def __init__(self, bar_count: int) -> None:
        self._bar_count = bar_count

    def get_bars(self, symbol: str, timeframe: str, limit: int = 100) -> pd.DataFrame:
        return _make_bars(min(self._bar_count, limit))


def test_market_data_agent_returns_snapshots_for_symbols():
    agent = MarketDataFetcherAgent(client=MockAlpacaClient(bar_count=60))

    result = agent.run({"symbols": ["SPY", "AAPL"]})

    snapshots = result["market_snapshots"]
    assert len(snapshots) == 2
    assert all(isinstance(s, MarketSnapshot) for s in snapshots)
    assert snapshots[0].symbol == "SPY"
    assert snapshots[1].symbol == "AAPL"
    assert set(snapshots[0].indicators) == {"rsi_14", "ema_9", "ema_21", "vwap"}


def test_data_quality_is_full_with_enough_bars_and_valid_indicators():
    agent = MarketDataFetcherAgent(client=MockAlpacaClient(bar_count=60))

    result = agent.run({"symbols": ["SPY"], "lookback": 50})
    snapshot = result["market_snapshots"][0]

    assert snapshot.data_quality_score == 1.0
    assert snapshot.latest_price > 0
    assert snapshot.avg_volume_20 > 0
    assert all(value is not None for value in snapshot.indicators.values())


def test_data_quality_drops_when_bars_are_insufficient():
    agent = MarketDataFetcherAgent(client=MockAlpacaClient(bar_count=12))

    result = agent.run({"symbols": ["TSLA"], "lookback": 50})
    snapshot = result["market_snapshots"][0]

    assert len(snapshot.bars) == 12
    assert 0 <= snapshot.data_quality_score < 1.0
