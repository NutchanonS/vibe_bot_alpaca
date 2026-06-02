"""Loads environment variables and exposes typed config for the trading bot."""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    mode: str
    api_key: str
    secret_key: str
    base_url: str
    data_url: str

    postgres_host: str
    postgres_port: int
    postgres_db: str
    postgres_user: str
    postgres_password: str

    redis_host: str
    redis_port: int

    default_strategies: list[str]
    max_position_size_pct: float
    max_drawdown_pct: float

    telegram_bot_token: str
    telegram_chat_id: str
    discord_webhook_url: str


def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise EnvironmentError(f"Required environment variable '{key}' is not set.")
    return val


def load_config() -> Config:
    mode = os.getenv("ALPACA_MODE", "sandbox").lower()

    if mode == "production":
        api_key = _require("ALPACA_LIVE_API_KEY")
        secret_key = _require("ALPACA_LIVE_SECRET_KEY")
        base_url = "https://api.alpaca.markets"
        data_url = "https://data.alpaca.markets"
    else:
        api_key = _require("ALPACA_PAPER_API_KEY")
        secret_key = _require("ALPACA_PAPER_SECRET_KEY")
        base_url = "https://paper-api.alpaca.markets"
        data_url = "https://data.alpaca.markets"

    strategies_raw = os.getenv("DEFAULT_STRATEGIES", "rsi_mean_reversion,ema_crossover,vwap_breakout")

    return Config(
        mode=mode,
        api_key=api_key,
        secret_key=secret_key,
        base_url=base_url,
        data_url=data_url,
        postgres_host=os.getenv("POSTGRES_HOST", "localhost"),
        postgres_port=int(os.getenv("POSTGRES_PORT", "5432")),
        postgres_db=os.getenv("POSTGRES_DB", "tradingbot"),
        postgres_user=os.getenv("POSTGRES_USER", "trader"),
        postgres_password=os.getenv("POSTGRES_PASSWORD", ""),
        redis_host=os.getenv("REDIS_HOST", "localhost"),
        redis_port=int(os.getenv("REDIS_PORT", "6379")),
        default_strategies=[s.strip() for s in strategies_raw.split(",") if s.strip()],
        max_position_size_pct=float(os.getenv("MAX_POSITION_SIZE_PCT", "5")),
        max_drawdown_pct=float(os.getenv("MAX_DRAWDOWN_PCT", "10")),
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID", ""),
        discord_webhook_url=os.getenv("DISCORD_WEBHOOK_URL", ""),
    )


# Module-level singleton
settings = load_config()
