"""Stage 2: Momentum quality screen.

Runs on Stage 1 survivors (~20 symbols). Uses 1-minute and 5-minute bars
to assess whether the move is still healthy and offers a good risk/reward
entry setup.

Checks (each adds to deep_score):
  1. HOD hold  — price ≤ 20% below day's high (not already failed / sold off)
  2. Flag pattern — last 3–5 bars tightening in range (consolidation)
  3. VWAP reclaim — price crossed back above intraday VWAP (confirmed bid)
  4. Spread quality — ATR-normalised H-L of latest bar < threshold (tradeable)
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from broker.alpaca_client import alpaca
from scanner.momentum_screener import MomentumStage1Result
from utils.logger import get_logger

log = get_logger(__name__)

# ── Thresholds ─────────────────────────────────────────────────────────────────
HOD_HOLD_PCT      = 0.20    # price must be within 20% of HOD
FLAG_BARS         = 5       # bars to check for range tightening
FLAG_TIGHTEN_PCT  = 0.50    # latest range ≤ 50% of first range in window
VWAP_TOLERANCE    = 0.002   # price within 0.2% of VWAP counts as reclaim
SPREAD_MAX_ATR    = 0.08    # bar H-L / ATR ≤ 0.08 (tight spread)

# ── Scoring weights ────────────────────────────────────────────────────────────
SCORE_HOD_HOLD    = 1
SCORE_FLAG        = 2
SCORE_VWAP_RECLAIM = 2
SCORE_SPREAD      = 1


@dataclass
class MomentumStage2Result:
    symbol: str

    # Pass-through from Stage 1
    stage1_score:    float
    change_pct:      float
    rvol:            float
    latest_price:    float
    intraday_volume: float

    # Stage 2 scores
    deep_score:      float
    combined_score:  float

    # Flags
    hod_hold:         bool
    flag_pattern:     bool
    vwap_reclaim:     bool
    tight_spread:     bool

    day_high:    float | None = None
    vwap:        float | None = None

    stage1_signals: list[str] = field(default_factory=list)
    deep_signals:   list[str] = field(default_factory=list)


class MomentumQualityScreener:
    """Stage 2 screener — runs on Stage 1 momentum survivors."""

    def screen(
        self,
        stage1_results: list[MomentumStage1Result],
        top_n: int = 10,
    ) -> list[MomentumStage2Result]:
        results: list[MomentumStage2Result] = []
        for sr in stage1_results:
            try:
                result = self._score(sr)
                results.append(result)
            except Exception as exc:
                log.warning("MomentumQualityScreener skipped %s: %s", sr.symbol, exc)
                results.append(self._passthrough(sr))

        results.sort(key=lambda r: r.combined_score, reverse=True)
        return results[:top_n]

    # ── Per-symbol scoring ─────────────────────────────────────────────────────

    def _score(self, sr: MomentumStage1Result) -> MomentumStage2Result:
        bars_1m = self._fetch_bars(sr.symbol, "1Min", limit=60)

        if bars_1m is None or len(bars_1m) < 5:
            return self._passthrough(sr)

        close  = bars_1m["close"].astype(float)
        high   = bars_1m["high"].astype(float)
        low    = bars_1m["low"].astype(float)
        volume = bars_1m["volume"].astype(float)

        latest_price = float(close.iloc[-1])
        day_high     = float(high.max())
        deep_score   = 0.0
        deep_signals: list[str] = []

        # ── 1. HOD hold ────────────────────────────────────────────────────────
        hod_hold = False
        if day_high > 0:
            drawdown_from_hod = (day_high - latest_price) / day_high
            if drawdown_from_hod <= HOD_HOLD_PCT:
                hod_hold = True
                deep_score += SCORE_HOD_HOLD
                deep_signals.append(
                    f"Holding within {drawdown_from_hod*100:.1f}% of HOD (${day_high:.2f})"
                )
            else:
                deep_signals.append(
                    f"Sold off {drawdown_from_hod*100:.1f}% from HOD — caution"
                )

        # ── 2. Flag / consolidation pattern ───────────────────────────────────
        flag_pattern = False
        if len(bars_1m) >= FLAG_BARS:
            flag_pattern = self._detect_flag(high, low)
            if flag_pattern:
                deep_score += SCORE_FLAG
                deep_signals.append("Flag / tight consolidation on 1min bars")

        # ── 3. VWAP reclaim ───────────────────────────────────────────────────
        vwap_val  = self._vwap(high, low, close, volume)
        vwap_reclaim = False
        if vwap_val is not None and vwap_val > 0:
            # Check if price recently crossed back above VWAP
            vwap_reclaim = self._check_vwap_reclaim(close, high, low, volume)
            if vwap_reclaim:
                deep_score += SCORE_VWAP_RECLAIM
                deep_signals.append(f"VWAP reclaimed at ${vwap_val:.2f}")

        # ── 4. Spread quality ──────────────────────────────────────────────────
        tight_spread = False
        atr = self._atr(high, low, close, period=14)
        if atr and atr > 0:
            latest_hl = float(high.iloc[-1] - low.iloc[-1])
            spread_ratio = latest_hl / atr
            if spread_ratio <= SPREAD_MAX_ATR * 10:  # normalised to atr units
                tight_spread = True
                deep_score += SCORE_SPREAD
                deep_signals.append("Tight spread — good liquidity")

        combined = sr.score + deep_score

        return MomentumStage2Result(
            symbol=sr.symbol,
            stage1_score=sr.score,
            change_pct=sr.change_pct,
            rvol=sr.rvol,
            latest_price=latest_price,
            intraday_volume=sr.intraday_volume,
            deep_score=deep_score,
            combined_score=combined,
            hod_hold=hod_hold,
            flag_pattern=flag_pattern,
            vwap_reclaim=vwap_reclaim,
            tight_spread=tight_spread,
            day_high=day_high,
            vwap=vwap_val,
            stage1_signals=sr.signals,
            deep_signals=deep_signals,
        )

    # ── Pattern helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _detect_flag(high: pd.Series, low: pd.Series) -> bool:
        """True if the last FLAG_BARS bars show tightening range (flag/pennant)."""
        window_high = high.iloc[-FLAG_BARS:]
        window_low  = low.iloc[-FLAG_BARS:]
        ranges = (window_high - window_low).values
        if len(ranges) < 2 or ranges[0] <= 0:
            return False
        first_range = ranges[0]
        last_range  = ranges[-1]
        return bool(last_range <= first_range * FLAG_TIGHTEN_PCT)

    @staticmethod
    def _check_vwap_reclaim(
        close: pd.Series,
        high: pd.Series,
        low: pd.Series,
        volume: pd.Series,
    ) -> bool:
        """True if price crossed above VWAP in the last 5 bars."""
        if len(close) < 6:
            return False
        typical = (high + low + close) / 3
        cum_vol  = volume.cumsum()
        if cum_vol.iloc[-1] == 0:
            return False
        vwap_series = (typical * volume).cumsum() / cum_vol
        for i in range(-5, -1):
            prev_c = float(close.iloc[i - 1])
            curr_c = float(close.iloc[i])
            prev_v = float(vwap_series.iloc[i - 1])
            curr_v = float(vwap_series.iloc[i])
            if prev_c < prev_v and curr_c >= curr_v:
                return True
        return False

    @staticmethod
    def _vwap(
        high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series
    ) -> float | None:
        typical = (high + low + close) / 3
        cum_vol  = volume.cumsum()
        if cum_vol.iloc[-1] == 0:
            return None
        val = ((typical * volume).cumsum() / cum_vol).iloc[-1]
        return None if pd.isna(val) else float(val)

    @staticmethod
    def _atr(
        high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14
    ) -> float | None:
        prev_close = close.shift(1)
        tr = pd.concat([
            (high - low).abs(),
            (high - prev_close).abs(),
            (low  - prev_close).abs(),
        ], axis=1).max(axis=1)
        val = tr.rolling(window=period, min_periods=1).mean().iloc[-1]
        return None if pd.isna(val) else float(val)

    @staticmethod
    def _fetch_bars(symbol: str, timeframe: str, limit: int) -> pd.DataFrame | None:
        try:
            bars = alpaca.get_bars(symbol, timeframe, limit=limit)
            if bars is None or (isinstance(bars, pd.DataFrame) and bars.empty):
                return None
            if not isinstance(bars, pd.DataFrame):
                bars = pd.DataFrame(bars)
            if not {"open", "high", "low", "close", "volume"}.issubset(bars.columns):
                return None
            return bars
        except Exception:
            return None

    @staticmethod
    def _passthrough(sr: MomentumStage1Result) -> MomentumStage2Result:
        """Carry Stage 1 forward with no deep score when bars unavailable."""
        return MomentumStage2Result(
            symbol=sr.symbol,
            stage1_score=sr.score,
            change_pct=sr.change_pct,
            rvol=sr.rvol,
            latest_price=sr.latest_price,
            intraday_volume=sr.intraday_volume,
            deep_score=0.0,
            combined_score=sr.score,
            hod_hold=False,
            flag_pattern=False,
            vwap_reclaim=False,
            tight_spread=False,
            stage1_signals=sr.signals,
        )
