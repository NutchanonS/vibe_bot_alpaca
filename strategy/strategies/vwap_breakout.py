"""VWAP Breakout strategy — buy when price breaks above VWAP with high volume."""

from __future__ import annotations

import numpy as np
import pandas as pd

from indicators.vwap import VWAP
from strategies.base_strategy import BaseStrategy, Signal, SignalType


class VWAPBreakout(BaseStrategy):
    name = "vwap_breakout"
    params = {
        "volume_zscore_threshold": 1.5,
        "lookback_volume": 20,
    }

    def __init__(self, symbols: list[str], params: dict | None = None):
        super().__init__(symbols, params)
        self._vwap = VWAP()

    def generate_signal(self, symbol: str, bars: pd.DataFrame) -> Signal:
        if len(bars) < self.params["lookback_volume"] + 2:
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)

        vwap_series = self._vwap.compute(bars)
        curr_vwap = vwap_series.iloc[-1]
        prev_vwap = vwap_series.iloc[-2]
        curr_close = bars["close"].iloc[-1]
        prev_close = bars["close"].iloc[-2]

        if pd.isna(curr_vwap) or pd.isna(prev_vwap):
            return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)

        vol_window = bars["volume"].iloc[-self.params["lookback_volume"]:]
        vol_mean = vol_window.mean()
        vol_std = vol_window.std()
        curr_vol = bars["volume"].iloc[-1]
        vol_zscore = (curr_vol - vol_mean) / vol_std if vol_std > 0 else 0

        broke_above = (prev_close <= prev_vwap) and (curr_close > curr_vwap)
        broke_below = (prev_close >= prev_vwap) and (curr_close < curr_vwap)
        high_volume = vol_zscore >= self.params["volume_zscore_threshold"]

        if broke_above and high_volume:
            return Signal(
                symbol=symbol,
                signal=SignalType.BUY,
                strategy=self.name,
                strength=min(1.0, vol_zscore / 3),
                metadata={"vwap": curr_vwap, "vol_zscore": vol_zscore},
            )

        if broke_below:
            return Signal(
                symbol=symbol,
                signal=SignalType.SELL,
                strategy=self.name,
                strength=1.0,
                metadata={"vwap": curr_vwap, "vol_zscore": vol_zscore},
            )

        return Signal(symbol=symbol, signal=SignalType.HOLD, strategy=self.name)
