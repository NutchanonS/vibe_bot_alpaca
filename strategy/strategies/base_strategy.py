"""Abstract base class for all trading strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import pandas as pd


class SignalType(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


@dataclass
class Signal:
    symbol: str
    signal: SignalType
    strategy: str
    strength: float = 1.0          # 0.0–1.0 for position sizing
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_actionable(self) -> bool:
        return self.signal in (SignalType.BUY, SignalType.SELL)


class BaseStrategy(ABC):
    name: str = "base"
    enabled: bool = True
    params: dict[str, Any] = {}

    def __init__(self, symbols: list[str], params: dict[str, Any] | None = None):
        self.symbols = symbols
        if params:
            self.params = {**self.params, **params}

    @abstractmethod
    def generate_signal(self, symbol: str, bars: pd.DataFrame) -> Signal:
        """Given recent OHLCV bars, return a Signal for this symbol."""
        ...

    def run(self, symbol: str, bars: pd.DataFrame) -> Signal:
        if not self.enabled:
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)
        if bars is None or len(bars) < 2:
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)
        return self.generate_signal(symbol, bars)
