"""EMA Crossover strategy — buy on fast/slow EMA cross with volume confirmation."""

from __future__ import annotations

import pandas as pd

from indicators.ema import EMA
from strategies.base_strategy import BaseStrategy, Signal, SignalType


class EMACrossover(BaseStrategy):
    name = "ema_crossover"
    params = {
        "fast_period": 9,
        "slow_period": 21,
        "volume_multiplier": 1.2,
    }

    def __init__(self, symbols: list[str], params: dict | None = None):
        super().__init__(symbols, params)
        self._fast_ema = EMA(period=self.params["fast_period"])
        self._slow_ema = EMA(period=self.params["slow_period"])

    def generate_signal(self, symbol: str, bars: pd.DataFrame) -> Signal:
        if len(bars) < self.params["slow_period"] + 2:
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)

        fast = self._fast_ema.compute(bars)
        slow = self._slow_ema.compute(bars)

        prev_fast, curr_fast = fast.iloc[-2], fast.iloc[-1]
        prev_slow, curr_slow = slow.iloc[-2], slow.iloc[-1]

        if any(pd.isna(v) for v in [prev_fast, curr_fast, prev_slow, curr_slow]):
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)

        avg_vol = bars["volume"].iloc[-20:].mean()
        curr_vol = bars["volume"].iloc[-1]
        volume_ok = curr_vol >= avg_vol * self.params["volume_multiplier"]

        crossed_above = (prev_fast <= prev_slow) and (curr_fast > curr_slow)
        crossed_below = (prev_fast >= prev_slow) and (curr_fast < curr_slow)

        if crossed_above and volume_ok:
            gap = abs(curr_fast - curr_slow) / curr_slow
            return Signal(
                symbol=symbol,
                signal=SignalType.BUY,
                strategy=self.name,
                strength=min(1.0, gap * 100),
                metadata={"fast_ema": curr_fast, "slow_ema": curr_slow},
            )

        if crossed_below:
            return Signal(
                symbol=symbol,
                signal=SignalType.SELL,
                strategy=self.name,
                strength=1.0,
                metadata={"fast_ema": curr_fast, "slow_ema": curr_slow},
            )

        return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)
