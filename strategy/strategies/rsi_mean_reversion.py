"""RSI Mean Reversion strategy — buy oversold, sell overbought."""

from __future__ import annotations

import pandas as pd

from indicators.rsi import RSI
from indicators.bollinger import BollingerBands
from strategies.base_strategy import BaseStrategy, Signal, SignalType


class RSIMeanReversion(BaseStrategy):
    name = "rsi_mean_reversion"
    params = {
        "rsi_period": 14,
        "oversold": 30,
        "overbought": 70,
        "use_bollinger": False,
    }

    def __init__(self, symbols: list[str], params: dict | None = None):
        super().__init__(symbols, params)
        self._rsi = RSI(period=self.params["rsi_period"])
        self._bb = BollingerBands()

    def generate_signal(self, symbol: str, bars: pd.DataFrame) -> Signal:
        rsi = self._rsi.compute(bars)
        last_rsi = rsi.iloc[-1]

        if pd.isna(last_rsi):
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)

        use_bb = self.params.get("use_bollinger", False)
        close = bars["close"].iloc[-1]

        if use_bb:
            bb = self._bb.compute(bars)
            bb_lower = bb["BB_lower"].iloc[-1]
            bb_upper = bb["BB_upper"].iloc[-1]
        else:
            bb_lower = bb_upper = None

        if last_rsi < self.params["oversold"]:
            if use_bb and bb_lower is not None and close > bb_lower:
                # Price bouncing off lower band — stronger confirmation
                strength = min(1.0, (self.params["oversold"] - last_rsi) / 20)
            else:
                strength = min(1.0, (self.params["oversold"] - last_rsi) / 20)
            return Signal(
                symbol=symbol,
                signal=SignalType.BUY,
                strategy=self.name,
                strength=strength,
                metadata={"rsi": last_rsi},
            )

        if last_rsi > self.params["overbought"]:
            strength = min(1.0, (last_rsi - self.params["overbought"]) / 20)
            return Signal(
                symbol=symbol,
                signal=SignalType.SELL,
                strategy=self.name,
                strength=strength,
                metadata={"rsi": last_rsi},
            )

        return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name, metadata={"rsi": last_rsi})
