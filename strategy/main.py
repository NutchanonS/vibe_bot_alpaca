"""Bot entrypoint — APScheduler loop that runs strategies and executes signals."""

from __future__ import annotations

import sys
import uuid
import redis
import json
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from broker.alpaca_client import alpaca
from broker.order_manager import order_manager
from config import settings
from risk.risk_manager import risk_manager
from strategies.registry import get_strategy
from strategies.base_strategy import SignalType
from utils.logger import get_logger
from utils.notifier import Notifier

log = get_logger(__name__)

WATCHLIST = ["SPY", "AAPL", "TSLA", "NVDA", "QQQ"]

_redis = redis.Redis(host=settings.redis_host, port=settings.redis_port, decode_responses=True)

notifier = Notifier(
    telegram_token=settings.telegram_bot_token,
    telegram_chat_id=settings.telegram_chat_id,
    discord_webhook=settings.discord_webhook_url,
)

_strategies = {
    name: get_strategy(name, WATCHLIST)
    for name in settings.default_strategies
}

try:
    from agents.orchestrator import AgentOrchestrator

    _agent_orchestrator = AgentOrchestrator()
except Exception as exc:
    _agent_orchestrator = None
    log.warning("Agent orchestrator unavailable: %s", exc)

try:
    from scanner.scan_pipeline import ScanPipeline

    _scan_pipeline = ScanPipeline(orchestrator=_agent_orchestrator)
except Exception as exc:
    _scan_pipeline = None
    log.warning("Scan pipeline unavailable: %s", exc)

try:
    from scanner.momentum_scan_pipeline import MomentumScanPipeline

    _momentum_pipeline = MomentumScanPipeline()
except Exception as exc:
    _momentum_pipeline = None
    log.warning("Momentum scan pipeline unavailable: %s", exc)


def _execute_signal(signal) -> None:
    if not signal.is_actionable():
        return
    if risk_manager.check_drawdown() or risk_manager.daily_loss_limit():
        log.warning("Risk limits hit — skipping signal %s %s", signal.signal, signal.symbol)
        return
    qty = risk_manager.position_size(signal.symbol, signal.strength)
    if qty <= 0:
        log.info("Zero qty for %s — skipping", signal.symbol)
        return
    order = order_manager.place_market_order(
        symbol=signal.symbol,
        qty=qty,
        side=signal.signal.value,
        strategy=signal.strategy,
    )
    if order:
        msg = f"[{signal.strategy}] {signal.signal.value.upper()} {qty} {signal.symbol}"
        log.info(msg)
        notifier.notify(msg)


def run_rsi_strategy() -> None:
    strategy = _strategies.get("rsi_mean_reversion")
    if not strategy:
        return
    for symbol in WATCHLIST:
        try:
            bars = alpaca.get_bars(symbol, "15Min", limit=50)
            signal = strategy.run(symbol, bars)
            _execute_signal(signal)
        except Exception as exc:
            log.error("RSI strategy error for %s: %s", symbol, exc)


def run_ema_strategy() -> None:
    strategy = _strategies.get("ema_crossover")
    if not strategy:
        return
    for symbol in WATCHLIST:
        try:
            bars = alpaca.get_bars(symbol, "1Hour", limit=50)
            signal = strategy.run(symbol, bars)
            _execute_signal(signal)
        except Exception as exc:
            log.error("EMA strategy error for %s: %s", symbol, exc)


def run_vwap_strategy() -> None:
    strategy = _strategies.get("vwap_breakout")
    if not strategy:
        return
    for symbol in WATCHLIST:
        try:
            bars = alpaca.get_bars(symbol, "5Min", limit=50)
            signal = strategy.run(symbol, bars)
            _execute_signal(signal)
        except Exception as exc:
            log.error("VWAP strategy error for %s: %s", symbol, exc)


def cache_portfolio_snapshot() -> None:
    try:
        account = alpaca.get_account()
        positions = alpaca.get_positions()
        snapshot = {
            "equity": str(account.equity),
            "cash": str(account.cash),
            "buying_power": str(account.buying_power),
            "positions": [
                {
                    "symbol": p.symbol,
                    "qty": str(p.qty),
                    "avg_entry_price": str(p.avg_entry_price),
                    "current_price": str(p.current_price),
                    "market_value": str(p.market_value),
                    "unrealized_pl": str(p.unrealized_pl),
                    "unrealized_plpc": str(p.unrealized_plpc),
                }
                for p in positions
            ],
        }
        _redis.set("portfolio:snapshot", json.dumps(snapshot), ex=120)
    except Exception as exc:
        log.error("Portfolio snapshot failed: %s", exc)


def daily_reset() -> None:
    risk_manager.reset_day_start()
    log.info("Daily risk counters reset.")


def _agent_status_error_payload(trigger: str, err: Exception) -> dict:
    return {
        "status": "error",
        "trigger": trigger,
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "error": str(err),
    }


def _set_agent_status(payload: dict) -> None:
    _redis.set("agent:status", json.dumps(payload), ex=3600)


def run_agent_pipeline(trigger: str = "scheduled", symbols: list[str] | None = None) -> None:
    symbols = symbols or WATCHLIST
    if _agent_orchestrator is None:
        payload = {
            "status": "disabled",
            "trigger": trigger,
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "error": "Agent orchestrator not available",
        }
        _set_agent_status(payload)
        return

    try:
        _set_agent_status(
            {
                "status": "running",
                "trigger": trigger,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "symbols": symbols,
            }
        )
        _, status = _agent_orchestrator.run(symbols=symbols, trigger=trigger)
        _set_agent_status(status)
        log.info("Agent pipeline completed (%s) for %s", trigger, symbols)
    except Exception as exc:
        payload = _agent_status_error_payload(trigger, exc)
        _set_agent_status(payload)
        log.error("Agent pipeline failed (%s): %s", trigger, exc)


def poll_scanner_run_requests() -> None:
    try:
        raw = _redis.get("scanner:run_request")
        if not raw:
            return

        _redis.delete("scanner:run_request")
        req = json.loads(raw) if raw else {}

        universe_name = req.get("universe") if isinstance(req, dict) else None
        stage1_top_n  = max(5, min(int(req.get("stage1_top_n", 20)), 9999))
        stage2_top_n  = max(3, min(int(req.get("stage2_top_n", 10)), 9999))

        if _scan_pipeline is None:
            _redis.set("scanner:status", json.dumps({
                "status": "error",
                "error": "Scan pipeline not available.",
            }), ex=3600)
            return

        _redis.set("scanner:status", json.dumps({
            "status":       "running",
            "started_at":   datetime.now(timezone.utc).isoformat(),
            "stage1_top_n": stage1_top_n,
            "stage2_top_n": stage2_top_n,
            "universe":     universe_name or "default",
        }), ex=3600)

        results = _scan_pipeline.run(
            universe_name=universe_name,
            stage1_top_n=stage1_top_n,
            stage2_top_n=stage2_top_n,
        )
        _redis.set("scanner:results", json.dumps(results), ex=3600)
        _redis.set("scanner:status", json.dumps({
            "status":           "ok",
            "completed_at":     results.get("completed_at"),
            "universe_size":    results.get("universe_size"),
            "stage1_count":     results.get("stage1_count"),
            "stage2_count":     results.get("stage2_count"),
            "candidates_found": len(results.get("ranked", [])),
        }), ex=3600)
        log.info("Waterfall scan completed — %d ranked candidates", len(results.get("ranked", [])))

    except Exception as exc:
        log.error("Scan pipeline failed: %s", exc)
        _redis.set("scanner:status", json.dumps({
            "status": "error",
            "error":  str(exc),
        }), ex=3600)


def poll_momentum_scan_requests() -> None:
    try:
        raw = _redis.get("momentum:run_request")
        if not raw:
            return

        _redis.delete("momentum:run_request")
        req = json.loads(raw) if raw else {}

        stage1_top_n = max(5,  min(int(req.get("stage1_top_n", 20)), 200))
        stage2_top_n = max(3,  min(int(req.get("stage2_top_n", 10)), 50))
        universe_str = req.get("universe") or None
        if universe_str not in (None, "all", "tech", "bio"):
            universe_str = None

        if _momentum_pipeline is None:
            _redis.set("momentum:status", json.dumps({
                "status": "error",
                "error": "Momentum scan pipeline not available.",
            }), ex=3600)
            return

        _redis.set("momentum:status", json.dumps({
            "status":       "running",
            "started_at":   datetime.now(timezone.utc).isoformat(),
            "stage1_top_n": stage1_top_n,
            "stage2_top_n": stage2_top_n,
            "universe":     universe_str or "all",
        }), ex=3600)

        results = _momentum_pipeline.run(
            universe=universe_str,
            stage1_top_n=stage1_top_n,
            stage2_top_n=stage2_top_n,
        )
        _redis.set("momentum:results", json.dumps(results), ex=3600)
        _redis.set("momentum:status", json.dumps({
            "status":         "ok",
            "completed_at":   results.get("completed_at"),
            "universe_size":  results.get("universe_size"),
            "stage1_count":   results.get("stage1_count"),
            "stage2_count":   results.get("stage2_count"),
            "candidates_found": len(results.get("ranked", [])),
        }), ex=3600)
        log.info("Momentum scan completed — %d ranked candidates", len(results.get("ranked", [])))

    except Exception as exc:
        log.error("Momentum scan pipeline failed: %s", exc)
        _redis.set("momentum:status", json.dumps({
            "status": "error",
            "error":  str(exc),
        }), ex=3600)


def poll_news_backtest_requests() -> None:
    try:
        raw = _redis.get("news_backtest:run_request")
        if not raw:
            return

        _redis.delete("news_backtest:run_request")
        req = json.loads(raw)

        symbol      = str(req.get("symbol", "SPY")).upper()
        start_date  = str(req.get("start_date", ""))
        end_date    = str(req.get("end_date", ""))
        sample_every = max(1, int(req.get("sample_every", 2)))

        if not start_date or not end_date:
            _redis.set("news_backtest:status", json.dumps({"status": "error", "error": "Missing start_date or end_date."}), ex=3600)
            return

        try:
            from news_backtest.runner import NewsBacktestRunner
            runner = NewsBacktestRunner()
        except Exception as exc:
            _redis.set("news_backtest:status", json.dumps({"status": "error", "error": f"Runner unavailable: {exc}"}), ex=3600)
            return

        _redis.set("news_backtest:status", json.dumps({
            "status":      "running",
            "symbol":      symbol,
            "start_date":  start_date,
            "end_date":    end_date,
            "sample_every": sample_every,
            "started_at":  datetime.now(timezone.utc).isoformat(),
        }), ex=3600)

        def _progress(step: int, total: int, day: str) -> None:
            _redis.set("news_backtest:status", json.dumps({
                "status":      "running",
                "symbol":      symbol,
                "step":        step,
                "total":       total,
                "current_day": day,
                "started_at":  datetime.now(timezone.utc).isoformat(),
            }), ex=3600)

        results = runner.run(symbol, start_date, end_date, sample_every=sample_every, progress_cb=_progress)
        _redis.set("news_backtest:results", json.dumps(results), ex=3600)
        _redis.set("news_backtest:status", json.dumps({
            "status":       results.get("status", "ok"),
            "symbol":       symbol,
            "completed_at": results.get("completed_at"),
            "total_days":   results.get("total_days", 0),
            "error":        results.get("error"),
        }), ex=3600)
        log.info("News backtest done for %s — %d days", symbol, results.get("total_days", 0))

    except Exception as exc:
        log.error("News backtest poll failed: %s", exc)
        _redis.set("news_backtest:status", json.dumps({"status": "error", "error": str(exc)}), ex=3600)


def poll_waterfall_validate_requests() -> None:
    try:
        raw = _redis.get("scanner:validate_request")
        if not raw:
            return

        _redis.delete("scanner:validate_request")
        req = json.loads(raw)

        date           = str(req.get("date", ""))
        universe_name  = req.get("universe") or None
        stage1_top_n   = max(5, min(int(req.get("stage1_top_n", 20)), 9999))
        stage2_top_n   = max(3, min(int(req.get("stage2_top_n", 10)), 9999))
        include_s3     = bool(req.get("include_stage3", True))
        include_s4     = bool(req.get("include_stage4", False))
        include_s5     = bool(req.get("include_stage5", False))
        forward_days   = max(1, min(int(req.get("forward_days", 3)), 10))

        if not date:
            _redis.set("scanner:validate_status", json.dumps({"status": "error", "error": "Missing date."}), ex=3600)
            return

        try:
            from scanner.waterfall_validator import WaterfallValidator
            validator = WaterfallValidator()
        except Exception as exc:
            _redis.set("scanner:validate_status", json.dumps({"status": "error", "error": f"Validator unavailable: {exc}"}), ex=3600)
            return

        _redis.set("scanner:validate_status", json.dumps({
            "status":      "running",
            "date":        date,
            "started_at":  datetime.now(timezone.utc).isoformat(),
        }), ex=3600)

        results = validator.validate(
            date=date,
            universe_name=universe_name,
            stage1_top_n=stage1_top_n,
            stage2_top_n=stage2_top_n,
            include_stage3=include_s3,
            include_stage4=include_s4,
            include_stage5=include_s5,
            forward_days=forward_days,
        )
        _redis.set("scanner:validate_results", json.dumps(results), ex=3600)
        _redis.set("scanner:validate_status", json.dumps({
            "status":       "ok",
            "date":         date,
            "completed_at": results.get("completed_at"),
            "n_final":      results.get("summary", {}).get("n_final", 0),
        }), ex=3600)
        log.info("Waterfall validation done for %s — %d candidates", date, results.get("summary", {}).get("n_final", 0))

    except Exception as exc:
        log.error("Waterfall validation failed: %s", exc)
        _redis.set("scanner:validate_status", json.dumps({"status": "error", "error": str(exc)}), ex=3600)


def poll_momentum_validate_requests() -> None:
    try:
        raw = _redis.get("momentum:validate_request")
        if not raw:
            return

        _redis.delete("momentum:validate_request")
        req = json.loads(raw)

        date         = str(req.get("date", ""))
        stage1_top_n = max(5,  min(int(req.get("stage1_top_n", 20)), 200))
        stage2_top_n = max(3,  min(int(req.get("stage2_top_n", 10)), 50))
        include_s3   = bool(req.get("include_stage3", True))
        include_s4   = bool(req.get("include_stage4", False))
        include_s5   = bool(req.get("include_stage5", False))

        if not date:
            _redis.set("momentum:validate_status", json.dumps({"status": "error", "error": "Missing date."}), ex=3600)
            return

        try:
            from scanner.momentum_validator import MomentumValidator
            validator = MomentumValidator()
        except Exception as exc:
            _redis.set("momentum:validate_status", json.dumps({"status": "error", "error": f"Validator unavailable: {exc}"}), ex=3600)
            return

        _redis.set("momentum:validate_status", json.dumps({
            "status":     "running",
            "date":       date,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }), ex=3600)

        results = validator.validate(
            date=date,
            stage1_top_n=stage1_top_n,
            stage2_top_n=stage2_top_n,
            include_stage3=include_s3,
            include_stage4=include_s4,
            include_stage5=include_s5,
        )
        _redis.set("momentum:validate_results", json.dumps(results), ex=3600)
        _redis.set("momentum:validate_status", json.dumps({
            "status":       "ok",
            "date":         date,
            "completed_at": results.get("completed_at"),
            "n_final":      results.get("summary", {}).get("n_final", 0),
        }), ex=3600)
        log.info("Momentum validation done for %s — %d candidates", date, results.get("summary", {}).get("n_final", 0))

    except Exception as exc:
        log.error("Momentum validation failed: %s", exc)
        _redis.set("momentum:validate_status", json.dumps({"status": "error", "error": str(exc)}), ex=3600)


def poll_waterfall_sweep_requests() -> None:
    try:
        raw = _redis.get("scanner:sweep_request")
        if not raw:
            return

        _redis.delete("scanner:sweep_request")
        req = json.loads(raw)

        start_date    = str(req.get("start_date", ""))
        end_date      = str(req.get("end_date", ""))
        universe_name = req.get("universe") or None
        stage1_top_n  = max(5, min(int(req.get("stage1_top_n", 20)), 9999))
        stage2_top_n  = max(3, min(int(req.get("stage2_top_n", 10)), 9999))
        include_s3    = bool(req.get("include_stage3", True))
        include_s4    = bool(req.get("include_stage4", False))
        include_s5    = bool(req.get("include_stage5", False))
        forward_days  = max(1, min(int(req.get("forward_days", 3)), 10))
        sample_every  = max(1, min(int(req.get("sample_every", 1)), 5))

        if not start_date or not end_date:
            _redis.set("scanner:sweep_status", json.dumps({"status": "error", "error": "Missing start_date or end_date."}), ex=7200)
            return

        try:
            from scanner.waterfall_validator import WaterfallValidator
            validator = WaterfallValidator()
        except Exception as exc:
            _redis.set("scanner:sweep_status", json.dumps({"status": "error", "error": f"Validator unavailable: {exc}"}), ex=7200)
            return

        _redis.set("scanner:sweep_status", json.dumps({
            "status":      "running",
            "start_date":  start_date,
            "end_date":    end_date,
            "step":        0,
            "total":       0,
            "current_date": start_date,
            "started_at":  datetime.now(timezone.utc).isoformat(),
        }), ex=7200)

        def progress_cb(step: int, total: int, current_date: str) -> None:
            _redis.set("scanner:sweep_status", json.dumps({
                "status":       "running",
                "start_date":   start_date,
                "end_date":     end_date,
                "step":         step,
                "total":        total,
                "current_date": current_date,
                "pct":          round(step / total * 100) if total else 0,
                "started_at":   datetime.now(timezone.utc).isoformat(),
            }), ex=7200)

        results = validator.sweep(
            start_date=start_date,
            end_date=end_date,
            universe_name=universe_name,
            stage1_top_n=stage1_top_n,
            stage2_top_n=stage2_top_n,
            include_stage3=include_s3,
            include_stage4=include_s4,
            include_stage5=include_s5,
            forward_days=forward_days,
            sample_every=sample_every,
            progress_cb=progress_cb,
        )
        _redis.set("scanner:sweep_results", json.dumps(results), ex=7200)
        _redis.set("scanner:sweep_status", json.dumps({
            "status":       "ok",
            "start_date":   start_date,
            "end_date":     end_date,
            "completed_at": results.get("completed_at"),
            "total_days":   results.get("summary", {}).get("total_days", 0),
            "total_picks":  results.get("summary", {}).get("total_picks", 0),
        }), ex=7200)
        log.info("Waterfall sweep done — %s to %s", start_date, end_date)

    except Exception as exc:
        log.error("Waterfall sweep failed: %s", exc)
        _redis.set("scanner:sweep_status", json.dumps({"status": "error", "error": str(exc)}), ex=7200)


def poll_momentum_sweep_requests() -> None:
    try:
        raw = _redis.get("momentum:sweep_request")
        if not raw:
            return

        _redis.delete("momentum:sweep_request")
        req = json.loads(raw)

        start_date   = str(req.get("start_date", ""))
        end_date     = str(req.get("end_date", ""))
        stage1_top_n = max(5, min(int(req.get("stage1_top_n", 20)), 200))
        stage2_top_n = max(3, min(int(req.get("stage2_top_n", 10)), 50))
        include_s3   = bool(req.get("include_stage3", True))
        include_s4   = bool(req.get("include_stage4", False))
        include_s5   = bool(req.get("include_stage5", False))
        sample_every = max(1, min(int(req.get("sample_every", 1)), 5))

        if not start_date or not end_date:
            _redis.set("momentum:sweep_status", json.dumps({"status": "error", "error": "Missing start_date or end_date."}), ex=7200)
            return

        try:
            from scanner.momentum_validator import MomentumValidator
            validator = MomentumValidator()
        except Exception as exc:
            _redis.set("momentum:sweep_status", json.dumps({"status": "error", "error": f"Validator unavailable: {exc}"}), ex=7200)
            return

        _redis.set("momentum:sweep_status", json.dumps({
            "status":       "running",
            "start_date":   start_date,
            "end_date":     end_date,
            "step":         0,
            "total":        0,
            "current_date": start_date,
            "started_at":   datetime.now(timezone.utc).isoformat(),
        }), ex=7200)

        def progress_cb(step: int, total: int, current_date: str) -> None:
            _redis.set("momentum:sweep_status", json.dumps({
                "status":       "running",
                "start_date":   start_date,
                "end_date":     end_date,
                "step":         step,
                "total":        total,
                "current_date": current_date,
                "pct":          round(step / total * 100) if total else 0,
                "started_at":   datetime.now(timezone.utc).isoformat(),
            }), ex=7200)

        results = validator.sweep(
            start_date=start_date,
            end_date=end_date,
            stage1_top_n=stage1_top_n,
            stage2_top_n=stage2_top_n,
            include_stage3=include_s3,
            include_stage4=include_s4,
            include_stage5=include_s5,
            sample_every=sample_every,
            progress_cb=progress_cb,
        )
        _redis.set("momentum:sweep_results", json.dumps(results), ex=7200)
        _redis.set("momentum:sweep_status", json.dumps({
            "status":       "ok",
            "start_date":   start_date,
            "end_date":     end_date,
            "completed_at": results.get("completed_at"),
            "total_days":   results.get("summary", {}).get("total_days", 0),
            "total_picks":  results.get("summary", {}).get("total_picks", 0),
        }), ex=7200)
        log.info("Momentum sweep done — %s to %s", start_date, end_date)

    except Exception as exc:
        log.error("Momentum sweep failed: %s", exc)
        _redis.set("momentum:sweep_status", json.dumps({"status": "error", "error": str(exc)}), ex=7200)


# ── Auto-trade helpers ────────────────────────────────────────────────────────

_AT_DEFAULTS = {"enabled": False, "mode": "approve", "min_confidence": 0.70, "max_daily_trades": 3}

def _at_settings(scanner: str) -> dict:
    raw = _redis.get(f"settings:{scanner}_auto_trade")
    return {**_AT_DEFAULTS, **json.loads(raw)} if raw else dict(_AT_DEFAULTS)

def _daily_count(scanner: str) -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return int(_redis.get(f"{scanner}:daily_trades:{today}") or 0)

def _inc_daily_count(scanner: str) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"{scanner}:daily_trades:{today}"
    _redis.incr(key)
    _redis.expire(key, 90_000)   # ~25 h

def _pending_key(scanner: str) -> str:
    return "scanner:pending_orders" if scanner == "waterfall" else "momentum:pending_orders"

def _load_pending(scanner: str) -> dict:
    raw = _redis.get(_pending_key(scanner))
    return json.loads(raw) if raw else {}

def _save_pending(scanner: str, orders: dict) -> None:
    _redis.set(_pending_key(scanner), json.dumps(orders), ex=86_400)

def _expires_at(scanner: str) -> str:
    now = datetime.now(timezone.utc)
    if scanner == "momentum":
        return (now + timedelta(hours=2)).isoformat()
    # Waterfall: expire at today's market close (21:00 UTC = 4 PM ET)
    eod = now.replace(hour=21, minute=0, second=0, microsecond=0)
    if eod <= now:
        eod += timedelta(days=1)
    return eod.isoformat()

def _place_auto_order(scanner: str, order: dict) -> bool:
    """Place a bracket order for an approved/auto pick. Returns True on success."""
    try:
        sl = order.get("stop_loss")
        pt = order.get("profit_target")
        qty = order.get("qty", 0)
        if not qty or qty <= 0:
            log.warning("Auto-trade skipped %s — qty=%s", order["symbol"], qty)
            return False
        if sl and pt:
            placed = order_manager.place_bracket_order(
                symbol=order["symbol"], qty=qty, side="buy",
                stop_loss=sl, take_profit=pt,
                strategy=f"scanner_{scanner}",
            )
        else:
            placed = order_manager.place_market_order(
                symbol=order["symbol"], qty=qty, side="buy",
                strategy=f"scanner_{scanner}",
            )
        if placed:
            msg = (f"[{scanner.title()} Auto-Trade] BUY {qty} {order['symbol']} "
                   f"conf={order.get('confidence', 0):.0%} "
                   f"SL={sl} TP={pt}")
            log.info(msg)
            notifier.notify(msg)
            _inc_daily_count(scanner)
            return True
        return False
    except Exception as exc:
        log.error("Auto-trade order failed for %s: %s", order.get("symbol"), exc)
        return False


def _normalize_pick(scanner: str, pick: dict) -> dict | None:
    """Return a normalized order dict from a scanner pick, or None if not tradeable."""
    direction = pick.get("direction", "NO_TRADE")
    if direction != "BUY":
        return None

    if scanner == "waterfall":
        if not pick.get("risk_approved", False):
            return None
        confidence   = float(pick.get("confidence", 0))
        qty          = pick.get("qty")
        entry_price  = pick.get("entry_price") or pick.get("latest_price")
        stop_loss    = pick.get("stop_loss")
        profit_target = pick.get("profit_target")
        risk_pct     = pick.get("risk_pct")
        rr_ratio     = pick.get("rr_ratio")
    else:  # momentum — different field names from MomentumSignalAgent
        confidence   = float(pick.get("signal_confidence", 0))
        entry_low    = float(pick.get("entry_zone_low")  or 0)
        entry_high   = float(pick.get("entry_zone_high") or 0)
        entry_price  = pick.get("latest_price") or (
            (entry_low + entry_high) / 2 if entry_low and entry_high else None
        )
        stop_loss    = pick.get("stop_loss") or None
        profit_target = pick.get("target_1") or None   # first target
        risk_pct     = float(pick.get("position_size_pct", 1.0))
        rr_ratio     = float(pick.get("rr_ratio", 0))
        # Compute qty from position_size_pct × account equity
        qty = pick.get("qty")
        if not qty and risk_pct and entry_price:
            try:
                acct = alpaca.get_account()
                trade_value = float(acct.equity) * (risk_pct / 100.0)
                qty = max(1, int(trade_value / float(entry_price)))
            except Exception as exc:
                log.warning("Could not compute qty for %s: %s", pick.get("symbol"), exc)

    if not qty:
        return None

    return {
        "id":           str(uuid.uuid4()),
        "scanner":      scanner,
        "symbol":       pick["symbol"],
        "direction":    "BUY",
        "confidence":   confidence,
        "reasoning":    pick.get("reasoning", ""),
        "qty":          qty,
        "entry_price":  entry_price,
        "stop_loss":    stop_loss,
        "profit_target": profit_target,
        "risk_pct":     risk_pct,
        "rr_ratio":     rr_ratio,
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "expires_at":   _expires_at(scanner),
        "status":       "pending",
    }


def _execute_scanner_signals(scanner: str, results: dict) -> None:
    """Route scanner BUY picks to auto-execute or pending-approval queue."""
    cfg = _at_settings(scanner)
    if not cfg.get("enabled", False):
        return

    mode        = cfg.get("mode", "approve")
    min_conf    = float(cfg.get("min_confidence", 0.70))
    max_daily   = int(cfg.get("max_daily_trades", 3))
    daily_count = _daily_count(scanner)
    pending     = _load_pending(scanner)

    queued = 0
    for pick in results.get("ranked", []):
        if daily_count + queued >= max_daily:
            break
        order = _normalize_pick(scanner, pick)
        if order is None:
            continue
        if order["confidence"] < min_conf:
            continue

        if mode == "auto":
            if _place_auto_order(scanner, order):
                daily_count += 1
        else:
            pending[order["id"]] = order
            queued += 1
            log.info("Queued for approval: %s %s conf=%.0f%%",
                     scanner, order["symbol"], order["confidence"] * 100)

    if mode == "approve" and queued:
        _save_pending(scanner, pending)
        notifier.notify(f"[{scanner.title()} Scanner] {queued} trade(s) waiting for approval in dashboard.")


def run_daily_waterfall_scan() -> None:
    """Scheduled: run waterfall scan at market open and route signals."""
    if _scan_pipeline is None:
        return
    log.info("Daily waterfall scan starting")
    try:
        results = _scan_pipeline.run()
        _redis.set("scanner:results", json.dumps(results), ex=7_200)
        _redis.set("scanner:status", json.dumps({
            "status":       "ok",
            "completed_at": results.get("completed_at"),
            "universe_size": results.get("universe_size"),
            "stage1_count": results.get("stage1_count"),
            "stage2_count": results.get("stage2_count"),
        }), ex=7_200)
        _execute_scanner_signals("waterfall", results)
    except Exception as exc:
        log.error("Daily waterfall scan failed: %s", exc)


def run_daily_momentum_scan() -> None:
    """Scheduled: run momentum scan at market open and route signals."""
    if _momentum_pipeline is None:
        return
    log.info("Daily momentum scan starting")
    try:
        results = _momentum_pipeline.run()
        _redis.set("momentum:results", json.dumps(results), ex=7_200)
        _redis.set("momentum:status", json.dumps({
            "status":       "ok",
            "completed_at": results.get("completed_at"),
            "universe_size": results.get("universe_size"),
            "stage1_count": results.get("stage1_count"),
            "stage2_count": results.get("stage2_count"),
            "candidates_found": len(results.get("ranked", [])),
        }), ex=7_200)
        _execute_scanner_signals("momentum", results)
    except Exception as exc:
        log.error("Daily momentum scan failed: %s", exc)


def poll_order_approvals() -> None:
    """Poll both pending-order queues, execute any human-approved orders."""
    for scanner in ("waterfall", "momentum"):
        try:
            pending = _load_pending(scanner)
            if not pending:
                continue
            changed = False
            now = datetime.now(timezone.utc)
            for oid, order in list(pending.items()):
                # Purge expired orders
                expires = order.get("expires_at")
                if expires and datetime.fromisoformat(expires) < now:
                    order["status"] = "expired"
                    changed = True
                    continue
                if order.get("status") == "approved":
                    cfg = _at_settings(scanner)
                    max_daily = int(cfg.get("max_daily_trades", 3))
                    if _daily_count(scanner) < max_daily:
                        ok = _place_auto_order(scanner, order)
                        order["status"] = "executed" if ok else "failed"
                    else:
                        order["status"] = "skipped_limit"
                    changed = True
            if changed:
                _save_pending(scanner, pending)
        except Exception as exc:
            log.error("poll_order_approvals [%s] failed: %s", scanner, exc)


def poll_agent_run_requests() -> None:
    try:
        raw = _redis.get("agent:run_request")
        if not raw:
            return

        _redis.delete("agent:run_request")
        req = json.loads(raw)
        symbols = req.get("symbols") if isinstance(req, dict) else None
        if not isinstance(symbols, list) or not symbols:
            symbols = WATCHLIST
        run_agent_pipeline(trigger="manual", symbols=[str(s).upper() for s in symbols])
    except Exception as exc:
        log.error("Failed to poll agent run request: %s", exc)


def main() -> None:
    log.info("Starting Alpaca Trading Bot in %s mode", settings.mode)

    scheduler = BlockingScheduler(timezone="America/New_York")

    # Portfolio cache every minute
    scheduler.add_job(cache_portfolio_snapshot, IntervalTrigger(minutes=1), id="portfolio_cache")

    # Agentic pipeline every 5 minutes (status available in dashboard)
    scheduler.add_job(run_agent_pipeline, IntervalTrigger(minutes=5), id="agent_pipeline")

    # Manual trigger poll from backend /api/agent/run
    scheduler.add_job(poll_agent_run_requests,  IntervalTrigger(seconds=15), id="agent_run_poll")

    # Scanner trigger poll from backend /api/scanner/run
    scheduler.add_job(poll_scanner_run_requests, IntervalTrigger(seconds=15), id="scanner_run_poll")

    # Momentum scan trigger poll from backend /api/momentum/run
    scheduler.add_job(poll_momentum_scan_requests, IntervalTrigger(seconds=15), id="momentum_scan_poll")

    # News sentiment backtest trigger poll
    scheduler.add_job(poll_news_backtest_requests, IntervalTrigger(seconds=15), id="news_backtest_poll")

    # Scanner validation polls (single-date)
    scheduler.add_job(poll_waterfall_validate_requests, IntervalTrigger(seconds=15), id="waterfall_validate_poll")
    scheduler.add_job(poll_momentum_validate_requests,  IntervalTrigger(seconds=15), id="momentum_validate_poll")

    # Scanner sweep polls (multi-date range)
    scheduler.add_job(poll_waterfall_sweep_requests, IntervalTrigger(seconds=15), id="waterfall_sweep_poll")
    scheduler.add_job(poll_momentum_sweep_requests,  IntervalTrigger(seconds=15), id="momentum_sweep_poll")

    # Daily auto-trade scans (market open, Mon-Fri, US/Eastern)
    scheduler.add_job(run_daily_momentum_scan,  CronTrigger(day_of_week="mon-fri", hour=9, minute=31), id="daily_momentum_scan")
    scheduler.add_job(run_daily_waterfall_scan, CronTrigger(day_of_week="mon-fri", hour=9, minute=35), id="daily_waterfall_scan")

    # Poll human-approved orders every 15 s and execute
    scheduler.add_job(poll_order_approvals, IntervalTrigger(seconds=15), id="order_approvals_poll")

    # VWAP strategy every 5 minutes (intraday only)
    scheduler.add_job(run_vwap_strategy, IntervalTrigger(minutes=5), id="vwap")

    # RSI strategy every 15 minutes
    scheduler.add_job(run_rsi_strategy, IntervalTrigger(minutes=15), id="rsi")

    # EMA strategy every hour
    scheduler.add_job(run_ema_strategy, IntervalTrigger(hours=1), id="ema")

    # Daily reset at market open
    scheduler.add_job(daily_reset, CronTrigger(day_of_week="mon-fri", hour=9, minute=30), id="daily_reset")

    log.info("Scheduler started. Press Ctrl+C to stop.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Bot stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
