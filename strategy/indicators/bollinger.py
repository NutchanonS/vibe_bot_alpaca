"""Bollinger Bands indicator."""

import pandas as pd
import pandas_ta as ta
from indicators.base_indicator import BaseIndicator


class BollingerBands(BaseIndicator):
    def __init__(self, period: int = 20, std: float = 2.0):
        self.period = period
        self.std = std

    def compute(self, df: pd.DataFrame) -> pd.DataFrame:
        bbands = ta.bbands(df["close"], length=self.period, std=self.std)
        return bbands.rename(columns={
            f"BBL_{self.period}_{self.std}": "BB_lower",
            f"BBM_{self.period}_{self.std}": "BB_mid",
            f"BBU_{self.period}_{self.std}": "BB_upper",
            f"BBB_{self.period}_{self.std}": "BB_bandwidth",
            f"BBP_{self.period}_{self.std}": "BB_pct",
        })
