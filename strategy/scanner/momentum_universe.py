"""Candidate universe for the high-momentum scanner.

Primary:  Alpaca market-movers endpoint (top gainers by % change)
Fallback: curated list of historically volatile names (biotech, small-cap
          growth, meme stocks) used when the API is unavailable or returns
          too few symbols.
"""

from __future__ import annotations

import requests
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

_MOVERS_URL = "https://data.alpaca.markets/v1beta1/screener/stocks/movers"

# Curated volatile names — used as fallback / merged with live movers
_VOLATILE_UNIVERSE: list[str] = [
    # High-beta tech / semis
    "NVDA", "AMD", "TSLA", "META", "NFLX", "SHOP", "SNAP", "PINS",
    "RBLX", "COIN", "MSTR", "SMCI", "PLTR", "PATH", "AI", "SOUN",
    # Biotech (frequent catalyst moves)
    "MRNA", "BNTX", "SGEN", "RCKT", "ARCT", "BEAM", "EDIT", "NTLA",
    "CRSP", "ACMR", "IOVA", "INMD", "ACAD", "FOLD", "RARE", "PTGX",
    # Small/mid-cap growth
    "IONQ", "RXRX", "WOLF", "NKLA", "RIVN", "LCID", "FSR", "BLNK",
    "CHPT", "EVGO", "QS", "STEM", "SPWR", "RUN", "NOVA", "ENPH",
    # Leveraged / high-vol ETFs
    "SQQQ", "TQQQ", "UVXY", "LABD", "LABU", "FNGU", "FNGD",
    # Meme / squeeze candidates
    "GME", "AMC", "BBBY", "CLOV", "WISH", "WKHS", "MVIS",
]
_VOLATILE_UNIVERSE = list(dict.fromkeys(_VOLATILE_UNIVERSE))


def get_momentum_universe(top_n: int = 50, include_fallback: bool = True) -> list[str]:
    """Return a deduplicated list of high-momentum candidates.

    Tries Alpaca's movers API first. Merges with the static volatile list
    if include_fallback=True or the API call fails.
    """
    movers = _fetch_alpaca_movers(top_n)
    if include_fallback or not movers:
        merged = list(dict.fromkeys(movers + _VOLATILE_UNIVERSE))
        return merged[:max(top_n, len(movers))]
    return movers


def _fetch_alpaca_movers(top_n: int) -> list[str]:
    """Call Alpaca screener/movers endpoint. Returns [] on any error."""
    try:
        resp = requests.get(
            _MOVERS_URL,
            headers={
                "APCA-API-KEY-ID":     settings.api_key,
                "APCA-API-SECRET-KEY": settings.secret_key,
            },
            params={"top": top_n, "by": "percent_change"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        gainers = data.get("gainers", [])
        symbols = [g["symbol"] for g in gainers if isinstance(g, dict) and g.get("symbol")]
        log.info("Alpaca movers API returned %d gainers", len(symbols))
        return symbols
    except Exception as exc:
        log.warning("Alpaca movers API unavailable (%s) — using fallback universe", exc)
        return []
