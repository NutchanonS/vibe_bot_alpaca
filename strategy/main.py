"""Bot entrypoint — APScheduler loop that runs strategies and executes signals."""

from __future__ import annotations

import sys
import redis
import json

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
                    "market_value": str(p.market_value),
                    "unrealized_pl": str(p.unrealized_pl),
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


def main() -> None:
    log.info("Starting Alpaca Trading Bot in %s mode", settings.mode)

    scheduler = BlockingScheduler(timezone="America/New_York")

    # Portfolio cache every minute
    scheduler.add_job(cache_portfolio_snapshot, IntervalTrigger(minutes=1), id="portfolio_cache")

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
