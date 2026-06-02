"""VWAP (Volume Weighted Average Price) indicator."""

import pandas as pd
import pandas_ta as ta
from indicators.base_indicator import BaseIndicator


class VWAP(BaseIndicator):
    def compute(self, df: pd.DataFrame) -> pd.Series:
        result = ta.vwap(df["high"], df["low"], df["close"], df["volume"])
        return result.rename("VWAP")
