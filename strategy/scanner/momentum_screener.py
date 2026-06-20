"""Stage 1: Fast momentum pre-filter.

Fetches Alpaca snapshots (single API call per batch) to get today's
% change and intraday volume, then computes RVOL from recent daily bars.

Hard gates (all must pass):
  • Today's % change  ≥ MIN_CHANGE_PCT  (default 5 %)
  • Relative Volume   ≥ MIN_RVOL        (default 3×)
  • Price             in [MIN_PRICE, MAX_PRICE]
  • Intraday volume   ≥ MIN_INTRADAY_VOL

Scoring on survivors produces a ranked list for Stage 2.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

import pandas as pd
import requests

from broker.alpaca_client import alpaca
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

_SNAPSHOT_URL = "https://data.alpaca.markets/v2/stocks/snapshots"

# ── Hard gates ─────────────────────────────────────────────────────────────────
MIN_CHANGE_PCT    = 5.0      # % gain today required
MIN_RVOL          = 3.0      # relative-volume multiplier
MIN_PRICE         = 1.0      # $ — avoids sub-penny
MAX_PRICE         = 100.0    # $ — focus on big-% movers, not mega-caps
MIN_INTRADAY_VOL  = 500_000  # shares traded today so far

# ── Scoring weights ────────────────────────────────────────────────────────────
W_CHANGE   = 0.4   # % change component
W_RVOL     = 0.4   # RVOL component
W_QUALITY  = 0.2   # price / volume quality bonus


@dataclass
class MomentumStage1Result:
    symbol:          str
    score:           float
    latest_price:    float
    change_pct:      float          # % gain today
    rvol:            float          # relative volume vs 10-day avg
    intraday_volume: float          # shares traded so far today
    avg_daily_vol:   float          # 10-day average daily volume
    open_price:      float | None
    prev_close:      float | None
    signals:         list[str] = field(default_factory=list)


class MomentumScreener:
    """Stage 1 screener — filters candidate universe to top momentum movers."""

    def screen(
        self,
        symbols: list[str],
        top_n: int = 20,
    ) -> list[MomentumStage1Result]:
        if not symbols:
            return []

        # Fetch all snapshots in one API call
        snapshots = self._fetch_snapshots(symbols)

        results: list[MomentumStage1Result] = []
        for symbol in symbols:
            try:
                snap = snapshots.get(symbol)
                if snap is None:
                    continue
                result = self._evaluate(symbol, snap)
                if result is not None:
                    results.append(result)
            except Exception as exc:
                log.warning("MomentumScreener skipped %s: %s", symbol, exc)

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_n]

    # ── Per-symbol evaluation ──────────────────────────────────────────────────

    def _evaluate(self, symbol: str, snap: dict) -> MomentumStage1Result | None:
        daily_bar  = snap.get("dailyBar")       or {}
        prev_bar   = snap.get("prevDailyBar")   or {}
        latest_trade = snap.get("latestTrade")  or {}

        latest_price = float(latest_trade.get("p") or daily_bar.get("c") or 0)
        open_price   = float(daily_bar.get("o") or 0) or None
        prev_close   = float(prev_bar.get("c")  or 0) or None
        intraday_vol = float(daily_bar.get("v")  or 0)

        if latest_price <= 0:
            return None

        # Price gate
        if not (MIN_PRICE <= latest_price <= MAX_PRICE):
            return None

        # Today's % change (vs prev close preferred, vs open as fallback)
        ref = prev_close or open_price
        if not ref or ref <= 0:
            return None
        change_pct = (latest_price - ref) / ref * 100

        if change_pct < MIN_CHANGE_PCT:
            return None

        # Volume gate
        if intraday_vol < MIN_INTRADAY_VOL:
            return None

        # RVOL — compare projected daily vol vs 10-day avg
        avg_daily = self._avg_daily_volume(symbol)
        rvol = 0.0
        if avg_daily > 0:
            hours_elapsed = self._hours_elapsed_today()
            projected_vol = intraday_vol * (6.5 / max(hours_elapsed, 0.25))
            rvol = projected_vol / avg_daily

        if rvol < MIN_RVOL:
            return None

        signals: list[str] = []
        signals.append(f"+{change_pct:.1f}% today")
        signals.append(f"RVOL {rvol:.1f}×")

        # Scoring: normalise change_pct and rvol, combine
        change_norm = min(change_pct / 30.0, 1.0)   # 30% = max expected
        rvol_norm   = min(rvol / 10.0, 1.0)         # 10× = saturated
        quality_bonus = 0.0
        if MIN_PRICE * 3 <= latest_price <= MAX_PRICE * 0.5:
            quality_bonus = 1.0   # mid-range price — better liquidity

        score = (
            W_CHANGE  * change_norm +
            W_RVOL    * rvol_norm   +
            W_QUALITY * quality_bonus
        )

        return MomentumStage1Result(
            symbol=symbol,
            score=score,
            latest_price=latest_price,
            change_pct=change_pct,
            rvol=rvol,
            intraday_volume=intraday_vol,
            avg_daily_vol=avg_daily,
            open_price=open_price,
            prev_close=prev_close,
            signals=signals,
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _fetch_snapshots(self, symbols: list[str]) -> dict[str, dict]:
        """Batch snapshot fetch — one HTTP call for up to 1000 symbols."""
        chunk_size = 100
        out: dict[str, dict] = {}
        for i in range(0, len(symbols), chunk_size):
            batch = symbols[i : i + chunk_size]
            try:
                resp = requests.get(
                    _SNAPSHOT_URL,
                    headers={
                        "APCA-API-KEY-ID":     settings.api_key,
                        "APCA-API-SECRET-KEY": settings.secret_key,
                    },
                    params={"symbols": ",".join(batch), "feed": "iex"},
                    timeout=15,
                )
                resp.raise_for_status()
                out.update(resp.json())
            except Exception as exc:
                log.warning("Snapshot API error for batch: %s", exc)
        return out

    def _avg_daily_volume(self, symbol: str) -> float:
        """Fetch 10-day daily bars and return average volume."""
        try:
            bars = alpaca.get_bars(symbol, "1Day", limit=10)
            if bars is None or (isinstance(bars, pd.DataFrame) and bars.empty):
                return 0.0
            return float(bars["volume"].astype(float).mean())
        except Exception:
            return 0.0

    @staticmethod
    def _hours_elapsed_today() -> float:
        """Approximate hours elapsed since NYSE open (9:30 ET)."""
        now_utc = datetime.now(timezone.utc)
        # NYSE opens at 14:30 UTC (9:30 ET)
        market_open_utc = now_utc.replace(hour=14, minute=30, second=0, microsecond=0)
        if now_utc < market_open_utc:
            return 0.25
        elapsed = (now_utc - market_open_utc).total_seconds() / 3600
        return max(elapsed, 0.25)
