"""Risk and capital allocation agent (Step 4)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd
from pydantic import BaseModel, Field

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

MAX_ADD_PCT_IF_HOLDING = 2.0
MAX_OPEN_POSITIONS = 5
MAX_SINGLE_TRADE_RISK_PCT = 1.5

SYSTEM_PROMPT = (
    "You are a risk-first portfolio allocator for an automated trading system. "
    "Given signal confidence, portfolio context, and volatility, suggest conservative position sizing, "
    "stop-loss, and profit target. "
    "Avoid aggressive sizing in uncertain conditions. "
    "Return practical values suitable for immediate execution."
)


@dataclass
class RiskAllocation:
    approved: bool
    symbol: str
    qty: int
    entry_price: float
    stop_loss: float
    profit_target: float
    risk_pct: float
    reasoning: str
    rejection_reason: str | None


class RiskAllocationModel(BaseModel):
    symbol: str
    qty: int = Field(ge=0)
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    profit_target: float = Field(gt=0)
    risk_pct: float = Field(ge=0)
    reasoning: str


class RiskCapitalAllocationAgent(BaseAgent):
    """Applies deterministic risk guardrails and LLM-assisted sizing."""

    name = "risk_capital_allocation"

    def __init__(self, client: Any = None, model: str = "gpt-4o-mini") -> None:
        self.model = model
        self.client = client or self._build_client()

    def run(self, state: dict) -> dict:
        portfolio = state.get("portfolio") or state.get("portfolio_snapshot") or {}
        selections = self._collect_signal_selections(state)
        snapshots = state.get("market_snapshots", [])
        snapshot_by_symbol = {self._snapshot_symbol(s): s for s in snapshots if self._snapshot_symbol(s)}

        allocations: dict[str, RiskAllocation] = {}
        for symbol, selection in selections.items():
            allocation = self._allocate_for_symbol(symbol, selection, portfolio, snapshot_by_symbol.get(symbol))
            allocations[symbol] = allocation

        out = dict(state)
        out["risk_allocations"] = allocations
        if len(allocations) == 1:
            out["risk_allocation"] = next(iter(allocations.values()))
        return out

    def _allocate_for_symbol(
        self,
        symbol: str,
        selection: Any,
        portfolio: Any,
        snapshot: Any,
    ) -> RiskAllocation:
        direction = self._selection_direction(selection)
        confidence = self._selection_confidence(selection)
        if direction == "NO_TRADE":
            return self._reject(symbol, "Signal direction is NO_TRADE.")

        equity, cash, positions = self._parse_portfolio(portfolio)
        if equity <= 0:
            return self._reject(symbol, "Invalid portfolio equity.")

        current_price = self._latest_price(selection, snapshot)
        if current_price <= 0:
            return self._reject(symbol, "Invalid entry price.")

        held_qty = self._held_quantity(positions, symbol)
        open_positions_count = self._open_positions_count(positions)

        if direction == "BUY" and held_qty <= 0 and open_positions_count >= MAX_OPEN_POSITIONS:
            return self._reject(symbol, "Rejected: open positions limit reached (>=5).")

        if direction == "SELL" and held_qty <= 0:
            return self._reject(symbol, "Rejected: cannot SELL without an open position.")

        max_position_qty = int((equity * (settings.max_position_size_pct / 100.0)) / current_price)
        add_qty_cap = int((equity * (MAX_ADD_PCT_IF_HOLDING / 100.0)) / current_price)

        if direction == "BUY":
            hard_cap_qty = max_position_qty
            if held_qty > 0:
                hard_cap_qty = min(hard_cap_qty, add_qty_cap)
        else:
            hard_cap_qty = int(held_qty)

        hard_cap_qty = max(0, hard_cap_qty)
        if hard_cap_qty <= 0:
            return self._reject(symbol, "Rejected: hard position cap resolves to zero shares.")

        atr_14 = self._compute_atr_14(snapshot)

        if not self.client:
            return self._reject(symbol, "OpenAI client unavailable.")

        try:
            llm = self._call_llm(
                symbol=symbol,
                direction=direction,
                confidence=confidence,
                equity=equity,
                cash=cash,
                open_positions_count=open_positions_count,
                held_qty=held_qty,
                entry_price=current_price,
                atr_14=atr_14,
                hard_cap_qty=hard_cap_qty,
            )
        except Exception as exc:
            log.error("RiskCapitalAllocationAgent failed for %s: %s", symbol, exc)
            return self._reject(symbol, "OpenAI sizing call failed.")

        return self._apply_hard_overrides(
            symbol=symbol,
            direction=direction,
            llm=llm,
            equity=equity,
            hard_cap_qty=hard_cap_qty,
            fallback_entry=current_price,
        )

    def _call_llm(
        self,
        *,
        symbol: str,
        direction: str,
        confidence: float,
        equity: float,
        cash: float,
        open_positions_count: int,
        held_qty: float,
        entry_price: float,
        atr_14: float,
        hard_cap_qty: int,
    ) -> RiskAllocationModel:
        prompt = self._build_user_prompt(
            symbol=symbol,
            direction=direction,
            confidence=confidence,
            equity=equity,
            cash=cash,
            open_positions_count=open_positions_count,
            held_qty=held_qty,
            entry_price=entry_price,
            atr_14=atr_14,
            hard_cap_qty=hard_cap_qty,
        )
        result = self.client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format=RiskAllocationModel,
        )
        parsed = result.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("No parsed allocation from OpenAI")
        return parsed

    def _apply_hard_overrides(
        self,
        *,
        symbol: str,
        direction: str,
        llm: RiskAllocationModel,
        equity: float,
        hard_cap_qty: int,
        fallback_entry: float,
    ) -> RiskAllocation:
        qty = int(max(0, llm.qty))
        qty = min(qty, hard_cap_qty)

        entry_price = float(llm.entry_price or fallback_entry)
        stop_loss = float(llm.stop_loss)
        profit_target = float(llm.profit_target)

        if direction == "BUY" and stop_loss >= entry_price:
            return self._reject(symbol, "Rejected: stop_loss must be below entry for BUY.")
        if direction == "SELL" and stop_loss <= entry_price:
            return self._reject(symbol, "Rejected: stop_loss must be above entry for SELL.")

        risk_per_share = abs(entry_price - stop_loss)
        if risk_per_share <= 0:
            return self._reject(symbol, "Rejected: stop-loss distance must be positive.")

        max_risk_dollars = equity * (MAX_SINGLE_TRADE_RISK_PCT / 100.0)
        risk_qty_cap = int(max_risk_dollars / risk_per_share)
        qty = min(qty, max(0, risk_qty_cap))

        if qty <= 0:
            return self._reject(symbol, "Rejected: risk cap reduces position size to zero.")

        risk_pct = (risk_per_share * qty / equity) * 100.0 if equity > 0 else 0.0
        reasoning = llm.reasoning
        if qty < llm.qty:
            reasoning = f"{reasoning} Hard cap override applied: qty capped to {qty}."

        return RiskAllocation(
            approved=True,
            symbol=symbol,
            qty=qty,
            entry_price=entry_price,
            stop_loss=stop_loss,
            profit_target=profit_target,
            risk_pct=round(risk_pct, 4),
            reasoning=reasoning,
            rejection_reason=None,
        )

    @staticmethod
    def _build_user_prompt(
        *,
        symbol: str,
        direction: str,
        confidence: float,
        equity: float,
        cash: float,
        open_positions_count: int,
        held_qty: float,
        entry_price: float,
        atr_14: float,
        hard_cap_qty: int,
    ) -> str:
        return "\n".join([
            f"Symbol: {symbol}",
            f"Direction: {direction}",
            f"Signal confidence: {confidence:.2f}",
            f"Portfolio equity: {equity:.2f}",
            f"Portfolio cash: {cash:.2f}",
            f"Open positions: {open_positions_count}",
            f"Held quantity for symbol: {held_qty:.4f}",
            f"Entry price: {entry_price:.4f}",
            f"ATR(14): {atr_14:.4f}",
            f"Absolute hard max quantity (deterministic cap): {hard_cap_qty}",
            "Return conservative qty, stop_loss, profit_target, and risk_pct.",
        ])

    @staticmethod
    def _collect_signal_selections(state: dict) -> dict[str, Any]:
        if isinstance(state.get("signal_selections"), dict):
            return {str(k): v for k, v in state["signal_selections"].items()}

        single = state.get("signal_selection") or state.get("signal_selection_result")
        if single is None:
            return {}
        symbol = RiskCapitalAllocationAgent._selection_symbol(single)
        if not symbol:
            return {}
        return {symbol: single}

    @staticmethod
    def _selection_symbol(selection: Any) -> str:
        if isinstance(selection, dict):
            return str(selection.get("symbol", ""))
        return str(getattr(selection, "symbol", ""))

    @staticmethod
    def _selection_direction(selection: Any) -> str:
        if isinstance(selection, dict):
            value = selection.get("direction", "NO_TRADE")
        else:
            value = getattr(selection, "direction", "NO_TRADE")
        return str(value).upper()

    @staticmethod
    def _selection_confidence(selection: Any) -> float:
        if isinstance(selection, dict):
            value = selection.get("confidence", 0.0)
        else:
            value = getattr(selection, "confidence", 0.0)
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _latest_price(selection: Any, snapshot: Any) -> float:
        if isinstance(snapshot, dict):
            value = snapshot.get("latest_price", 0.0)
        else:
            value = getattr(snapshot, "latest_price", 0.0)

        if value:
            return float(value)

        if isinstance(selection, dict):
            value = selection.get("entry_price", 0.0)
        else:
            value = getattr(selection, "entry_price", 0.0)
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _snapshot_symbol(snapshot: Any) -> str:
        if snapshot is None:
            return ""
        if isinstance(snapshot, dict):
            return str(snapshot.get("symbol", ""))
        return str(getattr(snapshot, "symbol", ""))

    @staticmethod
    def _compute_atr_14(snapshot: Any) -> float:
        bars = RiskCapitalAllocationAgent._bars_from_snapshot(snapshot)
        if bars is None or len(bars) < 2:
            return 0.0
        if not all(col in bars.columns for col in ("high", "low", "close")):
            return 0.0

        high = bars["high"].astype(float)
        low = bars["low"].astype(float)
        close = bars["close"].astype(float)

        prev_close = close.shift(1)
        tr = pd.concat([
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ], axis=1).max(axis=1)

        atr = tr.rolling(window=14, min_periods=1).mean().iloc[-1]
        if pd.isna(atr):
            return 0.0
        return float(atr)

    @staticmethod
    def _bars_from_snapshot(snapshot: Any) -> pd.DataFrame | None:
        if snapshot is None:
            return None
        if isinstance(snapshot, dict):
            bars = snapshot.get("bars")
        else:
            bars = getattr(snapshot, "bars", None)
        if isinstance(bars, pd.DataFrame):
            return bars
        return None

    @staticmethod
    def _parse_portfolio(portfolio: Any) -> tuple[float, float, list[dict[str, Any]]]:
        if not isinstance(portfolio, dict):
            return 0.0, 0.0, []
        equity = RiskCapitalAllocationAgent._as_float(portfolio.get("equity", 0.0))
        cash = RiskCapitalAllocationAgent._as_float(portfolio.get("cash", 0.0))
        positions = portfolio.get("positions", [])
        if not isinstance(positions, list):
            positions = []
        normalized = [p for p in positions if isinstance(p, dict)]
        return equity, cash, normalized

    @staticmethod
    def _held_quantity(positions: list[dict[str, Any]], symbol: str) -> float:
        target = symbol.upper()
        for pos in positions:
            if str(pos.get("symbol", "")).upper() != target:
                continue
            qty = RiskCapitalAllocationAgent._as_float(pos.get("qty", 0.0))
            if qty == 0.0:
                qty = RiskCapitalAllocationAgent._as_float(pos.get("quantity", 0.0))
            return max(0.0, qty)
        return 0.0

    @staticmethod
    def _open_positions_count(positions: list[dict[str, Any]]) -> int:
        count = 0
        for pos in positions:
            qty = RiskCapitalAllocationAgent._as_float(pos.get("qty", pos.get("quantity", 0.0)))
            if qty > 0:
                count += 1
        return count

    @staticmethod
    def _as_float(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _reject(symbol: str, reason: str) -> RiskAllocation:
        return RiskAllocation(
            approved=False,
            symbol=symbol,
            qty=0,
            entry_price=0.0,
            stop_loss=0.0,
            profit_target=0.0,
            risk_pct=0.0,
            reasoning=reason,
            rejection_reason=reason,
        )

    @staticmethod
    def _build_client() -> Any:
        if not settings.openai_api_key:
            return None
        try:
            from openai import OpenAI

            return OpenAI(api_key=settings.openai_api_key)
        except Exception as exc:
            log.error("Failed to initialize OpenAI client: %s", exc)
            return None
