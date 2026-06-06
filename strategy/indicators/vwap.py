"""VWAP (Volume Weighted Average Price) indicator."""

import pandas as pd
import pandas_ta as ta
from indicators.base_indicator import BaseIndicator


class VWAP(BaseIndicator):
    def compute(self, df: pd.DataFrame) -> pd.Series:
        work = df.copy()
        if not isinstance(work.index, pd.DatetimeIndex):
            ts_col = next((c for c in ("timestamp", "time") if c in work.columns), None)
            if ts_col:
                work = work.set_index(pd.to_datetime(work[ts_col], utc=True))
                work.index = work.index.sort_values()

        result = ta.vwap(work["high"], work["low"], work["close"], work["volume"])
        if result is None:
            typical = (work["high"].astype(float) + work["low"].astype(float) + work["close"].astype(float)) / 3.0
            volume = work["volume"].astype(float)
            result = (typical * volume).cumsum() / volume.cumsum().replace(0, pd.NA)
        return result.rename("VWAP")
