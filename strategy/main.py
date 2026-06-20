"""Bot entrypoint — APScheduler loop that runs strategies and executes signals."""

from __future__ import annotations

import sys
import redis
import json
from datetime import datetime, timezone

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

    # News sentiment backtest trigger poll
    scheduler.add_job(poll_news_backtest_requests, IntervalTrigger(seconds=15), id="news_backtest_poll")

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
