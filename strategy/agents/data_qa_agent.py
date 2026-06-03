"""Data quality check and circuit breaker agent (Step 2)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

import pandas as pd

from agents.base_agent import BaseAgent
from agents.market_data_agent import MarketSnapshot
from utils.logger import get_logger

log = get_logger(__name__)

QUALITY_THRESHOLD = 0.7      # below this → degraded
STALE_MINUTES     = 20       # older than this → blocked
CIRCUIT_BREAK_PCT = 0.5      # >50% symbols fail → halt cycle


@dataclass
class QAResult:
    approved_symbols: list[str]  = field(default_factory=list)
    degraded_symbols: list[str]  = field(default_factory=list)
    blocked_symbols:  list[str]  = field(default_factory=list)
    circuit_break:    bool        = False
    report:           str         = ""


class DataQAAgent(BaseAgent):
    """Validates MarketSnapshot objects and triggers a circuit break when
    too many symbols fail hard quality checks."""

    name = "data_qa"

    def __init__(
        self,
        quality_threshold: float = QUALITY_THRESHOLD,
        stale_minutes:     int   = STALE_MINUTES,
        circuit_break_pct: float = CIRCUIT_BREAK_PCT,
    ) -> None:
        self.quality_threshold = quality_threshold
        self.stale_minutes     = stale_minutes
        self.circuit_break_pct = circuit_break_pct

    def run(self, state: dict) -> dict:
        snapshots: list[MarketSnapshot] = state.get("market_snapshots", [])
        result = self._check(snapshots)
        if result.circuit_break:
            log.warning("CIRCUIT BREAK triggered: %s", result.report)
        else:
            log.info("DataQA: %s", result.report)
        out = dict(state)
        out["qa_result"] = result
        return out

    def _check(self, snapshots: list[MarketSnapshot]) -> QAResult:
        approved: list[str] = []
        degraded: list[str] = []
        blocked:  list[str] = []
        now = datetime.now(timezone.utc)

        for snap in snapshots:
            block_reason = self._hard_check(snap, now)
            if block_reason:
                log.debug("BLOCKED %s: %s", snap.symbol, block_reason)
                blocked.append(snap.symbol)
                continue

            if snap.data_quality_score < self.quality_threshold:
                log.debug("DEGRADED %s: quality=%.2f", snap.symbol, snap.data_quality_score)
                degraded.append(snap.symbol)
            else:
                approved.append(snap.symbol)

        total    = len(snapshots)
        n_failed = len(blocked)
        circuit_break = total > 0 and (n_failed / total) > self.circuit_break_pct

        report_parts = [
            f"{len(approved)} approved, {len(degraded)} degraded, {n_failed} blocked"
            f" (of {total} symbols)"
        ]
        if blocked:
            report_parts.append(f"Blocked: {blocked}")
        if circuit_break:
            report_parts.append(
                f"CIRCUIT BREAK: {n_failed}/{total} symbols failed hard checks"
            )

        return QAResult(
            approved_symbols=approved,
            degraded_symbols=degraded,
            blocked_symbols=blocked,
            circuit_break=circuit_break,
            report=" | ".join(report_parts),
        )

    def _hard_check(self, snap: MarketSnapshot, now: datetime) -> str | None:
        """Return a reason string if the snapshot fails a hard check, else None."""
        if snap.latest_price <= 0:
            return "latest_price <= 0"

        if snap.bars is not None and not snap.bars.empty:
            if snap.bars.isnull().all().any():
                return "DataFrame has all-NaN column"

        if snap.timestamp is not None:
            age_minutes = (now - snap.timestamp).total_seconds() / 60
            if age_minutes > self.stale_minutes:
                return f"stale data ({age_minutes:.1f}m > {self.stale_minutes}m)"

        return None
