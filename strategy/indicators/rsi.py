"""Relative Strength Index indicator."""

import pandas as pd
import pandas_ta as ta
from indicators.base_indicator import BaseIndicator


class RSI(BaseIndicator):
    def __init__(self, period: int = 14):
        self.period = period

    def compute(self, df: pd.DataFrame) -> pd.Series:
        result = ta.rsi(df["close"], length=self.period)
        return result.rename(f"RSI_{self.period}")
