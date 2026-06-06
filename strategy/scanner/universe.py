"""Default symbol universe for the market scanner."""

from __future__ import annotations

# S&P 100 most liquid names + major ETFs (~110 symbols)
_UNIVERSE: list[str] = [
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "ORCL", "ADBE",
    "CRM", "AMD", "QCOM", "INTC", "TXN", "AMAT", "LRCX", "KLAC", "MU", "NOW",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "AXP", "USB", "CME",
    "V", "MA", "SPGI", "MCO", "AON", "MMC",
    # Healthcare
    "UNH", "LLY", "JNJ", "ABBV", "MRK", "TMO", "ABT", "AMGN", "GILD", "ISRG",
    "VRTX", "REGN", "ZTS", "MDT", "ELV", "CI", "CVS", "BDX", "BMY", "SYK",
    # Consumer
    "COST", "HD", "WMT", "MCD", "SBUX", "NKE", "TJX", "LOW", "BKNG", "PG",
    "KO", "PEP", "PM", "MO",
    # Industrials / Energy
    "CAT", "GE", "BA", "RTX", "NOC", "DE", "ETN", "LIN",
    "XOM", "CVX", "COP", "EOG", "SLB", "MPC",
    # Utilities / Real estate
    "SO", "DUK", "D", "PLD",
    # Other large caps
    "NFLX", "ACN", "IBM", "INTU", "DHR", "PGR",
    # Autos
    "F", "GM",
    # Major ETFs (high volume, good signals)
    "SPY", "QQQ", "IWM", "DIA", "GLD", "TLT", "XLF", "XLK", "XLE", "ARKK",
    "SQQQ", "TQQQ",
]

# Remove duplicates while preserving order
_UNIVERSE = list(dict.fromkeys(_UNIVERSE))


def get_default_universe() -> list[str]:
    """Return the default symbol universe."""
    return list(_UNIVERSE)


def get_etfs_only() -> list[str]:
    return ["SPY", "QQQ", "IWM", "DIA", "GLD", "TLT", "XLF", "XLK", "XLE", "ARKK"]


def get_tech_universe() -> list[str]:
    return ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "AMD",
            "QCOM", "INTC", "TXN", "AMAT", "LRCX", "ADBE", "CRM", "NOW", "ORCL", "MU"]
