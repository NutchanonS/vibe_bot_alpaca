"""Smoke tests for all three strategies using synthetic bar data."""

import numpy as np
import pandas as pd
import pytest

from strategies.rsi_mean_reversion import RSIMeanReversion
from strategies.ema_crossover import EMACrossover
from strategies.vwap_breakout import VWAPBreakout
from strategies.base_strategy import SignalType


def _make_bars(n: int = 60, trend: str = "flat") -> pd.DataFrame:
    np.random.seed(42)
    close = 100 + np.cumsum(np.random.randn(n) * 0.5)
    if trend == "up":
        close += np.linspace(0, 10, n)
    elif trend == "down":
        close -= np.linspace(0, 10, n)
    high = close + abs(np.random.randn(n) * 0.3)
    low = close - abs(np.random.randn(n) * 0.3)
    volume = np.random.randint(1_000_000, 5_000_000, n).astype(float)
    return pd.DataFrame({"open": close, "high": high, "low": low, "close": close, "volume": volume})


def test_rsi_returns_signal():
    strategy = RSIMeanReversion(symbols=["TEST"])
    bars = _make_bars(60)
    signal = strategy.run("TEST", bars)
    assert signal.symbol == "TEST"
    assert signal.signal in SignalType.__members__.values()


def test_ema_returns_signal():
    strategy = EMACrossover(symbols=["TEST"])
    bars = _make_bars(60, trend="up")
    signal = strategy.run("TEST", bars)
    assert signal.symbol == "TEST"


def test_vwap_returns_signal():
    strategy = VWAPBreakout(symbols=["TEST"])
    bars = _make_bars(60)
    signal = strategy.run("TEST", bars)
    assert signal.symbol == "TEST"


def test_disabled_strategy_holds():
    strategy = RSIMeanReversion(symbols=["TEST"])
    strategy.enabled = False
    bars = _make_bars(60)
    signal = strategy.run("TEST", bars)
    assert signal.signal == SignalType.HOLD


def test_insufficient_bars_holds():
    strategy = EMACrossover(symbols=["TEST"])
    bars = _make_bars(5)
    signal = strategy.run("TEST", bars)
    assert signal.signal == SignalType.HOLD
