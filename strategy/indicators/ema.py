"""Exponential Moving Average indicator."""

import pandas as pd
import pandas_ta as ta
from indicators.base_indicator import BaseIndicator


class EMA(BaseIndicator):
    def __init__(self, period: int = 9):
        self.period = period

    def compute(self, df: pd.DataFrame) -> pd.Series:
        result = ta.ema(df["close"], length=self.period)
        return result.rename(f"EMA_{self.period}")
