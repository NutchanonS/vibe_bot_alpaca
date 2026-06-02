"""Strategy registry — maps name strings to strategy classes."""

from strategies.rsi_mean_reversion import RSIMeanReversion
from strategies.ema_crossover import EMACrossover
from strategies.vwap_breakout import VWAPBreakout

REGISTRY: dict[str, type] = {
    "rsi_mean_reversion": RSIMeanReversion,
    "ema_crossover": EMACrossover,
    "vwap_breakout": VWAPBreakout,
}


def get_strategy(name: str, symbols: list[str], params: dict | None = None):
    cls = REGISTRY.get(name)
    if cls is None:
        raise KeyError(f"Unknown strategy '{name}'. Available: {list(REGISTRY)}")
    return cls(symbols=symbols, params=params or {})
