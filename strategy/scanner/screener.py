"""Fast rule-based screener — filters symbol universe to high-potential candidates."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from broker.alpaca_client import alpaca
from utils.logger import get_logger

log = get_logger(__name__)

# ── Scoring weights ────────────────────────────────────────────────────────────
SCORE_RSI_EXTREME   = 2   # RSI < 35 (oversold) or > 65 (overbought)
SCORE_EMA_CROSS     = 2   # Fresh EMA9/21 crossover within last 3 bars
SCORE_MOMENTUM      = 1   # |5-bar momentum| > 1.5%
SCORE_VWAP_NEAR     = 1   # Price within 1 ATR of VWAP (potential breakout zone)
SCORE_NEWS_BONUS    = 1   # Symbol has news in last 24h (passed in from caller)

# ── Pre-filter thresholds ──────────────────────────────────────────────────────
MIN_AVG_VOLUME = 500_000   # shares/bar average
MIN_PRICE      = 5.0
MAX_PRICE      = 2_000.0


@dataclass
class ScreenerResult:
    symbol: str
    score: float
    latest_price: float
    rsi: float | None
    ema9: float | None
    ema21: float | None
    momentum_5bar_pct: float | None
    avg_volume: float
    ema_crossover_direction: str | None   # "bullish" | "bearish" | None
    vwap: float | None
    atr14: float | None
    screener_signals: list[str] = field(default_factory=list)


class MarketScreener:
    """Screens a universe of symbols and returns the top-N candidates by score."""

    def screen(
        self,
        symbols: list[str],
        top_n: int = 10,
        news_symbols: set[str] | None = None,
    ) -> list[ScreenerResult]:
        news_set = news_symbols or set()
        results: list[ScreenerResult] = []

        for symbol in symbols:
            try:
                result = self._score_symbol(symbol, news_set)
                if result is not None:
                    results.append(result)
            except Exception as exc:
                log.warning("Screener skipped %s: %s", symbol, exc)

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_n]

    # ── Per-symbol scoring ─────────────────────────────────────────────────────

    def _score_symbol(self, symbol: str, news_set: set[str]) -> ScreenerResult | None:
        bars = self._fetch_bars(symbol)
        if bars is None or len(bars) < 21:
            return None

        close  = bars["close"].astype(float)
        high   = bars["high"].astype(float)
        low    = bars["low"].astype(float)
        volume = bars["volume"].astype(float)

        latest_price = float(close.iloc[-1])
        avg_volume   = float(volume.mean())

        # Pre-filter: price and volume gates
        if not (MIN_PRICE <= latest_price <= MAX_PRICE):
            return None
        if avg_volume < MIN_AVG_VOLUME:
            return None

        score:   float      = 0.0
        signals: list[str]  = []

        # ── RSI ────────────────────────────────────────────────────────────────
        rsi = self._rsi(close)
        if rsi is not None:
            if rsi < 35:
                score += SCORE_RSI_EXTREME
                signals.append(f"RSI oversold ({rsi:.1f})")
            elif rsi > 65:
                score += SCORE_RSI_EXTREME
                signals.append(f"RSI overbought ({rsi:.1f})")

        # ── EMA crossover ──────────────────────────────────────────────────────
        ema9_s  = close.ewm(span=9,  adjust=False).mean()
        ema21_s = close.ewm(span=21, adjust=False).mean()
        ema9  = float(ema9_s.iloc[-1])  if not pd.isna(ema9_s.iloc[-1])  else None
        ema21 = float(ema21_s.iloc[-1]) if not pd.isna(ema21_s.iloc[-1]) else None

        cross_dir: str | None = None
        if len(bars) >= 4:
            for i in range(-3, 0):
                p9, p21 = float(ema9_s.iloc[i - 1]), float(ema21_s.iloc[i - 1])
                c9, c21 = float(ema9_s.iloc[i]),     float(ema21_s.iloc[i])
                if p9 <= p21 and c9 > c21:
                    score    += SCORE_EMA_CROSS
                    cross_dir = "bullish"
                    signals.append("EMA9 crossed above EMA21 (bullish)")
                    break
                if p9 >= p21 and c9 < c21:
                    score    += SCORE_EMA_CROSS
                    cross_dir = "bearish"
                    signals.append("EMA9 crossed below EMA21 (bearish)")
                    break

        # ── 5-bar momentum ─────────────────────────────────────────────────────
        momentum: float | None = None
        if len(close) >= 6:
            momentum = float((close.iloc[-1] - close.iloc[-6]) / close.iloc[-6]) * 100
            if abs(momentum) > 1.5:
                score += SCORE_MOMENTUM
                tag = "up" if momentum > 0 else "down"
                signals.append(f"5-bar momentum {tag} {abs(momentum):.2f}%")

        # ── VWAP proximity ─────────────────────────────────────────────────────
        vwap = self._vwap(high, low, close, volume)
        atr  = self._atr14(high, low, close)
        if vwap is not None and atr is not None and atr > 0:
            if abs(latest_price - vwap) <= atr:
                score += SCORE_VWAP_NEAR
                signals.append(f"Price within 1 ATR of VWAP (${vwap:.2f})")

        # ── News bonus ─────────────────────────────────────────────────────────
        if symbol in news_set:
            score += SCORE_NEWS_BONUS
            signals.append("News in last 24h")

        return ScreenerResult(
            symbol=symbol,
            score=score,
            latest_price=latest_price,
            rsi=rsi,
            ema9=ema9,
            ema21=ema21,
            momentum_5bar_pct=momentum,
            avg_volume=avg_volume,
            ema_crossover_direction=cross_dir,
            vwap=vwap,
            atr14=atr,
            screener_signals=signals,
        )

    # ── Data fetching ──────────────────────────────────────────────────────────

    @staticmethod
    def _fetch_bars(symbol: str) -> pd.DataFrame | None:
        try:
            bars = alpaca.get_bars(symbol, "15Min", limit=50)
            if bars is None:
                return None
            if isinstance(bars, pd.DataFrame) and bars.empty:
                return None
            if not isinstance(bars, pd.DataFrame):
                bars = pd.DataFrame(bars)
            required = {"open", "high", "low", "close", "volume"}
            if not required.issubset(set(bars.columns)):
                return None
            return bars
        except Exception:
            return None

    # ── Indicators (self-contained, no external import) ────────────────────────

    @staticmethod
    def _rsi(close: pd.Series, period: int = 14) -> float | None:
        if len(close) < period + 1:
            return None
        delta = close.diff()
        gain  = delta.clip(lower=0).rolling(period).mean()
        loss  = (-delta.clip(upper=0)).rolling(period).mean()
        rs    = gain / loss.replace(0, float("nan"))
        rsi   = (100 - (100 / (1 + rs))).iloc[-1]
        return None if pd.isna(rsi) else float(rsi)

    @staticmethod
    def _vwap(
        high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series
    ) -> float | None:
        typical  = (high + low + close) / 3
        cum_vol  = volume.cumsum()
        if cum_vol.iloc[-1] == 0:
            return None
        val = ((typical * volume).cumsum() / cum_vol).iloc[-1]
        return None if pd.isna(val) else float(val)

    @staticmethod
    def _atr14(high: pd.Series, low: pd.Series, close: pd.Series) -> float | None:
        prev_close = close.shift(1)
        tr = pd.concat([
            (high - low).abs(),
            (high - prev_close).abs(),
            (low  - prev_close).abs(),
        ], axis=1).max(axis=1)
        val = tr.rolling(window=14, min_periods=1).mean().iloc[-1]
        return None if pd.isna(val) else float(val)
