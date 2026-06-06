"""Stage 2: Deep technical + volume + relative-strength scan.

Runs on Stage 1 survivors only (~20 symbols) — never on the full universe.
Each check is self-contained and uses the same Alpaca bar data already available.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from broker.alpaca_client import alpaca
from scanner.screener import ScreenerResult
from utils.logger import get_logger

log = get_logger(__name__)

# ── Scoring weights (max 6 pts) ────────────────────────────────────────────────
SCORE_BB_SQUEEZE    = 2   # Bands contracting → coil before breakout
SCORE_VOLUME_SURGE  = 2   # Current vol > 2× 20-bar avg → institutional activity
SCORE_REL_STRENGTH  = 1   # 5-bar return beats SPY → alpha not beta
SCORE_TREND_ALIGN   = 1   # Price on correct side of EMA(50) → with the trend

# ── Thresholds ─────────────────────────────────────────────────────────────────
BB_PERIOD            = 20
BB_SQUEEZE_THRESHOLD = 0.04    # (upper − lower) / mid < 4%
VOLUME_SURGE_MULT    = 2.0     # current bar > 2× avg
EMA50_PERIOD         = 50
RS_LOOKBACK          = 5       # bars for relative-strength comparison


@dataclass
class DeepScreenResult:
    symbol: str

    # Scores
    stage1_score:    float
    deep_score:      float
    combined_score:  float    # stage1 + deep — used for final sort

    # Stage 2 flags
    bb_squeeze:               bool
    volume_surge:             bool
    relative_strength_vs_spy: float | None   # positive = outperforming
    trend_aligned:            bool | None    # None if direction ambiguous

    # Signal lists
    screener_signals: list[str] = field(default_factory=list)   # from Stage 1
    deep_signals:     list[str] = field(default_factory=list)   # from Stage 2


class DeepScreener:
    """Stage 2 screener — runs only on Stage 1 survivors."""

    def screen(
        self,
        stage1_results: list[ScreenerResult],
        top_n: int = 10,
        spy_bars: pd.DataFrame | None = None,
    ) -> list[DeepScreenResult]:
        # Fetch SPY once for relative-strength baseline
        if spy_bars is None:
            spy_bars = self._fetch_bars("SPY", limit=100)

        spy_ret5 = self._ret5(spy_bars) if spy_bars is not None else None

        results: list[DeepScreenResult] = []
        for sr in stage1_results:
            try:
                result = self._score(sr, spy_ret5)
                results.append(result)
            except Exception as exc:
                log.warning("DeepScreener skipped %s: %s", sr.symbol, exc)
                # Carry Stage 1 score with zero deep score so symbol is not lost
                results.append(DeepScreenResult(
                    symbol=sr.symbol,
                    stage1_score=sr.score,
                    deep_score=0,
                    combined_score=sr.score,
                    bb_squeeze=False,
                    volume_surge=False,
                    relative_strength_vs_spy=None,
                    trend_aligned=None,
                    screener_signals=sr.screener_signals,
                ))

        results.sort(key=lambda r: r.combined_score, reverse=True)
        return results[:top_n]

    # ── Per-symbol scoring ─────────────────────────────────────────────────────

    def _score(self, sr: ScreenerResult, spy_ret5: float | None) -> DeepScreenResult:
        bars = self._fetch_bars(sr.symbol, limit=100)

        # If bars unavailable, carry Stage 1 score with zero deep
        if bars is None or len(bars) < BB_PERIOD + 1:
            return DeepScreenResult(
                symbol=sr.symbol,
                stage1_score=sr.score,
                deep_score=0,
                combined_score=sr.score,
                bb_squeeze=False,
                volume_surge=False,
                relative_strength_vs_spy=None,
                trend_aligned=None,
                screener_signals=sr.screener_signals,
            )

        close  = bars["close"].astype(float)
        volume = bars["volume"].astype(float)

        deep_score:   float      = 0.0
        deep_signals: list[str]  = []

        # ── Bollinger Band squeeze ─────────────────────────────────────────────
        bb_sq = self._bb_squeeze(close)
        if bb_sq:
            deep_score += SCORE_BB_SQUEEZE
            deep_signals.append("Bollinger Band squeeze — breakout pending")

        # ── Volume surge ───────────────────────────────────────────────────────
        vol_surge = self._volume_surge(volume)
        if vol_surge:
            deep_score += SCORE_VOLUME_SURGE
            deep_signals.append(f"Volume surge (>{VOLUME_SURGE_MULT:.0f}× 20-bar avg)")

        # ── Relative strength vs SPY (5-bar return comparison) ─────────────────
        sym_ret5 = self._ret5(bars)
        rs_vs_spy: float | None = None
        if sym_ret5 is not None and spy_ret5 is not None:
            rs_vs_spy = round(sym_ret5 - spy_ret5, 3)
            if rs_vs_spy > 0:
                deep_score += SCORE_REL_STRENGTH
                deep_signals.append(f"Outperforming SPY by {rs_vs_spy:+.2f}% (5-bar)")

        # ── Trend alignment via EMA(50) ────────────────────────────────────────
        trend_aligned: bool | None = None
        if len(close) >= EMA50_PERIOD:
            ema50 = float(close.ewm(span=EMA50_PERIOD, adjust=False).mean().iloc[-1])
            price = float(close.iloc[-1])

            # Infer expected direction from Stage 1 signals
            s1_lower = " ".join(sr.screener_signals).lower()
            is_bullish = "oversold" in s1_lower or "bullish" in s1_lower or "up" in s1_lower
            is_bearish = "overbought" in s1_lower or "bearish" in s1_lower

            if is_bullish:
                trend_aligned = price > ema50
                if trend_aligned:
                    deep_score += SCORE_TREND_ALIGN
                    deep_signals.append(f"Price above EMA50 (${ema50:.2f}) — trend confirmed")
            elif is_bearish:
                trend_aligned = price < ema50
                if trend_aligned:
                    deep_score += SCORE_TREND_ALIGN
                    deep_signals.append(f"Price below EMA50 (${ema50:.2f}) — trend confirmed")

        return DeepScreenResult(
            symbol=sr.symbol,
            stage1_score=sr.score,
            deep_score=deep_score,
            combined_score=sr.score + deep_score,
            bb_squeeze=bb_sq,
            volume_surge=vol_surge,
            relative_strength_vs_spy=rs_vs_spy,
            trend_aligned=trend_aligned,
            screener_signals=sr.screener_signals,
            deep_signals=deep_signals,
        )

    # ── Indicator helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _bb_squeeze(close: pd.Series) -> bool:
        sma   = close.rolling(BB_PERIOD).mean()
        std   = close.rolling(BB_PERIOD).std()
        upper = sma + 2 * std
        lower = sma - 2 * std
        mid   = float(sma.iloc[-1])
        if mid == 0 or pd.isna(mid):
            return False
        width = float((upper.iloc[-1] - lower.iloc[-1]) / mid)
        return width < BB_SQUEEZE_THRESHOLD

    @staticmethod
    def _volume_surge(volume: pd.Series) -> bool:
        if len(volume) < 21:
            return False
        avg20 = float(volume.iloc[-21:-1].mean())
        curr  = float(volume.iloc[-1])
        return avg20 > 0 and curr >= avg20 * VOLUME_SURGE_MULT

    @staticmethod
    def _ret5(bars: pd.DataFrame | None) -> float | None:
        if bars is None or len(bars) < RS_LOOKBACK + 1:
            return None
        close = bars["close"].astype(float)
        ref   = float(close.iloc[-(RS_LOOKBACK + 1)])
        curr  = float(close.iloc[-1])
        if ref == 0:
            return None
        ret = (curr - ref) / ref * 100
        return None if pd.isna(ret) else ret

    @staticmethod
    def _fetch_bars(symbol: str, limit: int = 100) -> pd.DataFrame | None:
        try:
            bars = alpaca.get_bars(symbol, "15Min", limit=limit)
            if bars is None or (isinstance(bars, pd.DataFrame) and bars.empty):
                return None
            if not isinstance(bars, pd.DataFrame):
                bars = pd.DataFrame(bars)
            if not {"open", "high", "low", "close", "volume"}.issubset(bars.columns):
                return None
            return bars
        except Exception:
            return None
