"""Unit tests for NewsAnalysisAgent with mocked OpenAI responses."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.data_qa_agent import QAResult
from agents.news_analysis_agent import NewsAnalysisAgent, NewsSentiment
from agents.news_fetcher_agent import NewsArticle, NewsSnapshot


class _ParseResult:
    def __init__(self, parsed: NewsSentiment):
        self.choices = [type("Choice", (), {"message": type("Msg", (), {"parsed": parsed})()})()]


class _MockCompletions:
    def __init__(self, parsed: NewsSentiment | None = None, raise_exc: bool = False):
        self._parsed = parsed
        self._raise = raise_exc

    def parse(self, **_kwargs):
        if self._raise:
            raise TimeoutError("mock timeout")
        return _ParseResult(self._parsed)


class _MockClient:
    def __init__(self, parsed: NewsSentiment | None = None, raise_exc: bool = False):
        completions = _MockCompletions(parsed=parsed, raise_exc=raise_exc)
        chat = type("Chat", (), {"completions": completions})()
        beta = type("Beta", (), {"chat": chat})()
        self.beta = beta


def _article(headline: str) -> NewsArticle:
    return NewsArticle(
        id=1,
        headline=headline,
        summary="Revenue up and guidance raised.",
        source="Reuters",
        author="A",
        url="https://example.com",
        symbols=["AAPL"],
        created_at=datetime.now(timezone.utc),
    )


def test_analyzes_approved_symbol_with_articles():
    sentiment = NewsSentiment(
        symbol="AAPL",
        overall_sentiment=0.62,
        confidence=0.84,
        key_themes=["earnings beat"],
        risk_events=[],
        bullish_reasons=["guidance raised"],
        bearish_reasons=[],
        articles_analyzed=1,
        summary="Positive momentum after earnings beat.",
    )
    agent = NewsAnalysisAgent(client=_MockClient(parsed=sentiment))
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "news_snapshots": [NewsSnapshot(symbol="AAPL", articles=[_article("AAPL beats estimates")])],
    }

    result = agent.run(state)

    assert "news_sentiments" in result
    assert result["news_sentiments"]["AAPL"].overall_sentiment == 0.62


def test_returns_neutral_when_symbol_has_no_articles():
    agent = NewsAnalysisAgent(client=_MockClient(parsed=None))
    state = {
        "qa_result": QAResult(approved_symbols=["SPY"]),
        "news_snapshots": [NewsSnapshot(symbol="SPY", articles=[])],
    }

    result = agent.run(state)

    assert result["news_sentiments"]["SPY"].overall_sentiment == 0.0
    assert result["news_sentiments"]["SPY"].confidence == 0.0


def test_skips_blocked_symbols_not_in_approved_list():
    sentiment = NewsSentiment(
        symbol="AAPL",
        overall_sentiment=0.2,
        confidence=0.5,
        key_themes=[],
        risk_events=[],
        bullish_reasons=[],
        bearish_reasons=[],
        articles_analyzed=1,
        summary="Mixed.",
    )
    agent = NewsAnalysisAgent(client=_MockClient(parsed=sentiment))
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "news_snapshots": [
            NewsSnapshot(symbol="AAPL", articles=[_article("AAPL update")]),
            NewsSnapshot(symbol="TSLA", articles=[_article("TSLA update")]),
        ],
    }

    result = agent.run(state)

    assert "AAPL" in result["news_sentiments"]
    assert "TSLA" not in result["news_sentiments"]


def test_openai_failure_falls_back_to_neutral():
    agent = NewsAnalysisAgent(client=_MockClient(raise_exc=True))
    state = {
        "qa_result": QAResult(approved_symbols=["AAPL"]),
        "news_snapshots": [NewsSnapshot(symbol="AAPL", articles=[_article("AAPL update")])],
    }

    result = agent.run(state)

    assert result["news_sentiments"]["AAPL"].overall_sentiment == 0.0
    assert result["news_sentiments"]["AAPL"].confidence == 0.0
