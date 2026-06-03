"""News Fetcher Agent (Step 1b) — pulls financial news from Alpaca News API."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

_NEWS_URL = "https://data.alpaca.markets/v1beta1/news"


@dataclass
class NewsArticle:
    id:         int
    headline:   str
    summary:    str
    source:     str
    author:     str
    url:        str
    symbols:    list[str]
    created_at: datetime
    sentiment:  Optional[float] = None  # filled later by NewsAnalysisAgent


@dataclass
class NewsSnapshot:
    symbol:     str
    articles:   list[NewsArticle] = field(default_factory=list)
    fetched_at: datetime          = field(default_factory=lambda: datetime.now(timezone.utc))


class NewsFetcherAgent(BaseAgent):
    """Fetches recent news articles from Alpaca for the given symbols.

    Uses the same API key already configured for market data — no extra
    subscription required. Runs parallel to MarketDataFetcher (Step 1).
    """

    name = "news_fetcher"

    def __init__(
        self,
        lookback_hours:    int = 24,
        limit_per_symbol:  int = 10,
        timeout_seconds:   int = 10,
    ) -> None:
        self.lookback_hours   = lookback_hours
        self.limit_per_symbol = limit_per_symbol
        self.timeout          = timeout_seconds

    # ── BaseAgent contract ────────────────────────────────────────────────────

    def run(self, state: dict) -> dict:
        symbols: list[str] = state.get("symbols", [])
        lookback_hours = int(state.get("lookback_hours", self.lookback_hours))
        limit_per_symbol = int(state.get("limit_per_symbol", self.limit_per_symbol))
        snapshots = self.fetch(
            symbols,
            lookback_hours=lookback_hours,
            limit_per_symbol=limit_per_symbol,
        )
        out = dict(state)
        out["news_snapshots"] = snapshots
        return out

    # ── Public helper (also used by tests / backend) ──────────────────────────

    def fetch(
        self,
        symbols: list[str],
        lookback_hours: int | None = None,
        limit_per_symbol: int | None = None,
    ) -> list[NewsSnapshot]:
        """Fetch news for all symbols in a single API call, then group by symbol."""
        if not symbols:
            return []

        lookback = int(lookback_hours if lookback_hours is not None else self.lookback_hours)
        per_symbol_limit = int(limit_per_symbol if limit_per_symbol is not None else self.limit_per_symbol)

        start_iso = (
            datetime.now(timezone.utc) - timedelta(hours=lookback)
        ).isoformat()

        raw_articles = self._call_api(symbols, start_iso, per_symbol_limit)

        # Group by symbol — one article can appear under multiple symbols
        by_symbol: dict[str, list[NewsArticle]] = {sym: [] for sym in symbols}
        for raw in raw_articles:
            article = self._parse_article(raw)
            for sym in article.symbols:
                if sym in by_symbol:
                    by_symbol[sym].append(article)

        return [
            NewsSnapshot(
                symbol=sym,
                articles=by_symbol[sym][:per_symbol_limit],
            )
            for sym in symbols
        ]

    # ── Private ───────────────────────────────────────────────────────────────

    def _call_api(self, symbols: list[str], start_iso: str, per_symbol_limit: int) -> list[dict]:
        """Call Alpaca News API; returns raw article dicts. Never raises."""
        params: dict = {
            "symbols":         ",".join(symbols),
            "start":           start_iso,
            "limit":           min(per_symbol_limit * len(symbols), 50),
            "sort":            "desc",
            "include_content": "false",
        }
        try:
            resp = requests.get(
                _NEWS_URL,
                headers={
                    "APCA-API-KEY-ID":     settings.api_key,
                    "APCA-API-SECRET-KEY": settings.secret_key,
                },
                params=params,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json().get("news", [])
        except requests.RequestException as exc:
            log.error("NewsFetcherAgent API error: %s", exc)
            return []
        except Exception as exc:
            log.error("NewsFetcherAgent unexpected error: %s", exc)
            return []

    @staticmethod
    def _parse_article(raw: dict) -> NewsArticle:
        created_raw = raw.get("created_at", "")
        try:
            created_at = datetime.fromisoformat(
                created_raw.rstrip("Z")
            ).replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            created_at = datetime.now(timezone.utc)

        return NewsArticle(
            id=int(raw.get("id", 0)),
            headline=raw.get("headline", ""),
            summary=raw.get("summary", ""),
            source=raw.get("source", ""),
            author=raw.get("author", ""),
            url=raw.get("url", ""),
            symbols=raw.get("symbols", []),
            created_at=created_at,
        )
