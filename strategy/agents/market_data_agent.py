"""Market data agent for pulling bars and computing core indicators."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from agents.base_agent import BaseAgent


@dataclass
class MarketSnapshot:
    symbol: str
    timestamp: datetime
    bars: pd.DataFrame
    indicators: dict[str, float | None]
    latest_price: float
    avg_volume_20: float
    data_quality_score: float


class MarketDataFetcherAgent(BaseAgent):
    name = "market_data_fetcher"

    def __init__(
        self,
        client: Any = None,
        default_lookback: int = 50,
        default_timeframe: str = "15Min",
        min_quality_bars: int = 30,
    ) -> None:
        if client is None:
            from broker.alpaca_client import alpaca as default_client

            self.client = default_client
        else:
            self.client = client
        self.default_lookback = default_lookback
        self.default_timeframe = default_timeframe
        self.min_quality_bars = min_quality_bars

    def run(self, state: dict) -> dict:
        symbols = state.get("symbols") or []
        if not isinstance(symbols, list):
            raise ValueError("state['symbols'] must be a list")

        lookback = int(state.get("lookback", self.default_lookback))
        timeframe = str(state.get("timeframe", self.default_timeframe))

        snapshots: list[MarketSnapshot] = []
        for symbol in symbols:
            bars = self.client.get_bars(str(symbol), timeframe, limit=lookback)
            snapshots.append(self._build_snapshot(str(symbol), bars))

        out = dict(state)
        out["market_snapshots"] = snapshots
        return out

    def _build_snapshot(self, symbol: str, bars: pd.DataFrame) -> MarketSnapshot:
        bars = bars.copy()
        indicators = self._compute_indicators(bars)

        latest_price = float(bars["close"].iloc[-1]) if len(bars) > 0 else 0.0
        avg_volume_20 = float(bars["volume"].tail(20).mean()) if len(bars) > 0 else 0.0
        data_quality_score = self._data_quality_score(bars, indicators)

        return MarketSnapshot(
            symbol=symbol,
            timestamp=datetime.now(timezone.utc),
            bars=bars,
            indicators=indicators,
            latest_price=latest_price,
            avg_volume_20=avg_volume_20,
            data_quality_score=data_quality_score,
        )

    def _compute_indicators(self, bars: pd.DataFrame) -> dict[str, float | None]:
        if len(bars) == 0:
            return {"rsi_14": None, "ema_9": None, "ema_21": None, "vwap": None}

        rsi = self._compute_rsi(bars, period=14)
        ema_9 = self._compute_ema(bars, period=9)
        ema_21 = self._compute_ema(bars, period=21)
        vwap = self._compute_vwap(self._with_datetime_index(bars))

        return {
            "rsi_14": self._last_value(rsi),
            "ema_9": self._last_value(ema_9),
            "ema_21": self._last_value(ema_21),
            "vwap": self._last_value(vwap),
        }

    @staticmethod
    def _with_datetime_index(bars: pd.DataFrame) -> pd.DataFrame:
        df = bars.copy()
        if "timestamp" in df.columns:
            df = df.set_index(pd.to_datetime(df["timestamp"], utc=True))
        elif "time" in df.columns:
            df = df.set_index(pd.to_datetime(df["time"], utc=True))
        return df

    @staticmethod
    def _last_value(series: pd.Series) -> float | None:
        valid = series.dropna()
        if valid.empty:
            return None
        return float(valid.iloc[-1])

    @staticmethod
    def _compute_rsi(bars: pd.DataFrame, period: int) -> pd.Series:
        try:
            from indicators.rsi import RSI

            return RSI(period).compute(bars)
        except ModuleNotFoundError:
            close = bars["close"].astype(float)
            delta = close.diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            avg_gain = gain.rolling(window=period, min_periods=period).mean()
            avg_loss = loss.rolling(window=period, min_periods=period).mean()
            rs = avg_gain / avg_loss.replace(0, pd.NA)
            rsi = 100 - (100 / (1 + rs))
            return rsi.rename(f"RSI_{period}")

    @staticmethod
    def _compute_ema(bars: pd.DataFrame, period: int) -> pd.Series:
        try:
            from indicators.ema import EMA

            return EMA(period).compute(bars)
        except ModuleNotFoundError:
            close = bars["close"].astype(float)
            return close.ewm(span=period, adjust=False).mean().rename(f"EMA_{period}")

    @staticmethod
    def _compute_vwap(bars: pd.DataFrame) -> pd.Series:
        try:
            from indicators.vwap import VWAP

            return VWAP().compute(bars)
        except ModuleNotFoundError:
            typical = (bars["high"].astype(float) + bars["low"].astype(float) + bars["close"].astype(float)) / 3.0
            volume = bars["volume"].astype(float)
            cumulative_vol = volume.cumsum()
            cumulative_tpv = (typical * volume).cumsum()
            return (cumulative_tpv / cumulative_vol.replace(0, pd.NA)).rename("VWAP")

    def _data_quality_score(self, bars: pd.DataFrame, indicators: dict[str, float | None]) -> float:
        bar_score = min(len(bars), self.min_quality_bars) / float(self.min_quality_bars)
        valid_indicators = sum(1 for value in indicators.values() if value is not None and pd.notna(value))
        indicator_score = valid_indicators / float(len(indicators)) if indicators else 0.0

        if bar_score == 1.0 and indicator_score == 1.0:
            return 1.0
        return round(bar_score * indicator_score, 4)
