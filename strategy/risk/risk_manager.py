"""Position sizing, max drawdown kill switch, and daily loss limit."""

from __future__ import annotations

from broker.alpaca_client import alpaca
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

_PEAK_VALUE: float = 0.0
_DAY_START_VALUE: float = 0.0


class RiskManager:
    def __init__(self, max_position_pct: float, max_drawdown_pct: float, daily_loss_pct: float = 5.0):
        self.max_position_pct = max_position_pct
        self.max_drawdown_pct = max_drawdown_pct
        self.daily_loss_pct = daily_loss_pct

    def position_size(self, symbol: str, signal_strength: float = 1.0) -> float:
        """Return integer share qty based on portfolio % and signal strength."""
        try:
            account = alpaca.get_account()
            equity = float(account.equity)
            price = self._get_price(symbol)
            if price <= 0:
                return 0
            max_dollars = equity * (self.max_position_pct / 100) * signal_strength
            qty = int(max_dollars / price)
            return max(0, qty)
        except Exception as exc:
            log.error("position_size failed: %s", exc)
            return 0

    def check_drawdown(self) -> bool:
        """Return True if max drawdown kill switch is triggered."""
        global _PEAK_VALUE
        try:
            account = alpaca.get_account()
            equity = float(account.equity)
            if equity > _PEAK_VALUE:
                _PEAK_VALUE = equity
            if _PEAK_VALUE == 0:
                return False
            drawdown_pct = ((_PEAK_VALUE - equity) / _PEAK_VALUE) * 100
            if drawdown_pct >= self.max_drawdown_pct:
                log.warning("KILL SWITCH: drawdown %.2f%% >= limit %.2f%%", drawdown_pct, self.max_drawdown_pct)
                return True
            return False
        except Exception as exc:
            log.error("check_drawdown failed: %s", exc)
            return False

    def daily_loss_limit(self) -> bool:
        """Return True if daily loss limit is exceeded."""
        global _DAY_START_VALUE
        try:
            account = alpaca.get_account()
            equity = float(account.equity)
            if _DAY_START_VALUE == 0:
                _DAY_START_VALUE = equity
                return False
            daily_loss_pct = ((_DAY_START_VALUE - equity) / _DAY_START_VALUE) * 100
            if daily_loss_pct >= self.daily_loss_pct:
                log.warning("Daily loss limit %.2f%% hit — no new positions today.", daily_loss_pct)
                return True
            return False
        except Exception as exc:
            log.error("daily_loss_limit failed: %s", exc)
            return False

    def reset_day_start(self) -> None:
        global _DAY_START_VALUE, _PEAK_VALUE
        try:
            account = alpaca.get_account()
            equity = float(account.equity)
            _DAY_START_VALUE = equity
            if equity > _PEAK_VALUE:
                _PEAK_VALUE = equity
        except Exception as exc:
            log.error("reset_day_start failed: %s", exc)

    def _get_price(self, symbol: str) -> float:
        try:
            bars = alpaca.get_bars(symbol, "1Min", limit=1)
            return float(bars["close"].iloc[-1])
        except Exception:
            return 0.0


risk_manager = RiskManager(
    max_position_pct=settings.max_position_size_pct,
    max_drawdown_pct=settings.max_drawdown_pct,
)
