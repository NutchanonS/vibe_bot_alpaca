"""Unit tests for NewsFetcherAgent (Step 1b) — all API calls are mocked."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from agents.news_fetcher_agent import NewsArticle, NewsFetcherAgent, NewsSnapshot

# ── Fixtures ───────────────────────────────────────────────────────────────────

RAW_ARTICLE = {
    "id": 1001,
    "headline": "Apple Reports Record Earnings",
    "summary": "Apple Inc. beat analyst expectations...",
    "source": "Bloomberg",
    "author": "Jane Smith",
    "url": "https://example.com/article/1001",
    "symbols": ["AAPL", "QQQ"],
    "created_at": "2026-01-15T20:00:00Z",
    "images": [],
}

RAW_ARTICLE_SPY = {
    "id": 1002,
    "headline": "Fed signals rate cut",
    "summary": "Federal Reserve signals a possible rate cut...",
    "source": "Reuters",
    "author": "John Doe",
    "url": "https://example.com/article/1002",
    "symbols": ["SPY", "QQQ"],
    "created_at": "2026-01-15T19:30:00Z",
    "images": [],
}

MOCK_RESPONSE = {"news": [RAW_ARTICLE, RAW_ARTICLE_SPY]}


def _make_agent(**kw) -> NewsFetcherAgent:
    return NewsFetcherAgent(**kw)


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestNewsFetcherAgent:

    @patch("agents.news_fetcher_agent.requests.get")
    def test_fetch_returns_snapshots_for_each_symbol(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: MOCK_RESPONSE,
            raise_for_status=lambda: None,
        )
        agent = _make_agent()
        snapshots = agent.fetch(["AAPL", "SPY", "QQQ"])

        assert len(snapshots) == 3
        syms = {s.symbol for s in snapshots}
        assert syms == {"AAPL", "SPY", "QQQ"}

    @patch("agents.news_fetcher_agent.requests.get")
    def test_articles_grouped_by_symbol(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: MOCK_RESPONSE,
            raise_for_status=lambda: None,
        )
        agent = _make_agent()
        snapshots = {s.symbol: s for s in agent.fetch(["AAPL", "SPY", "QQQ"])}

        # AAPL article 1001 should be in AAPL and QQQ
        aapl_ids = {a.id for a in snapshots["AAPL"].articles}
        assert 1001 in aapl_ids

        # SPY article 1002 should be in SPY and QQQ
        spy_ids = {a.id for a in snapshots["SPY"].articles}
        assert 1002 in spy_ids

    @patch("agents.news_fetcher_agent.requests.get")
    def test_article_fields_parsed_correctly(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"news": [RAW_ARTICLE]},
            raise_for_status=lambda: None,
        )
        agent = _make_agent()
        snapshots = {s.symbol: s for s in agent.fetch(["AAPL"])}
        article = snapshots["AAPL"].articles[0]

        assert article.id == 1001
        assert article.headline == "Apple Reports Record Earnings"
        assert article.source == "Bloomberg"
        assert article.sentiment is None  # not set until NewsAnalysisAgent
        assert article.created_at.tzinfo is not None

    @patch("agents.news_fetcher_agent.requests.get")
    def test_api_failure_returns_empty_snapshots(self, mock_get):
        mock_get.side_effect = Exception("Network error")
        agent = _make_agent()
        snapshots = agent.fetch(["AAPL", "SPY"])

        # Should not raise; returns empty snapshots
        assert len(snapshots) == 2
        for snap in snapshots:
            assert snap.articles == []

    @patch("agents.news_fetcher_agent.requests.get")
    def test_run_updates_state(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: MOCK_RESPONSE,
            raise_for_status=lambda: None,
        )
        agent = _make_agent()
        state = {"symbols": ["AAPL", "SPY"], "extra_key": "preserved"}
        result = agent.run(state)

        assert "news_snapshots" in result
        assert result["extra_key"] == "preserved"
        assert len(result["news_snapshots"]) == 2

    @patch("agents.news_fetcher_agent.requests.get")
    def test_run_accepts_state_overrides(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"news": [RAW_ARTICLE]},
            raise_for_status=lambda: None,
        )
        agent = _make_agent(lookback_hours=24, limit_per_symbol=10)

        result = agent.run({"symbols": ["AAPL"], "lookback_hours": 6, "limit_per_symbol": 1})

        assert len(result["news_snapshots"]) == 1
        assert len(result["news_snapshots"][0].articles) == 1

    @patch("agents.news_fetcher_agent.requests.get")
    def test_limit_per_symbol_respected(self, mock_get):
        # Return 5 articles all tagged to AAPL
        many = [dict(RAW_ARTICLE, id=i, symbols=["AAPL"]) for i in range(10)]
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"news": many},
            raise_for_status=lambda: None,
        )
        agent = _make_agent(limit_per_symbol=3)
        snapshots = {s.symbol: s for s in agent.fetch(["AAPL"])}

        assert len(snapshots["AAPL"].articles) == 3

    def test_fetch_empty_symbols_returns_empty(self):
        agent = _make_agent()
        assert agent.fetch([]) == []
