"""News analysis agent (Step 2b) using OpenAI structured outputs."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any

from pydantic import BaseModel, Field

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

SYSTEM_PROMPT = (
    "You are a financial news analyst. Extract sentiment signals from news "
    "headlines and summaries. Be precise and conservative."
)


class NewsSentiment(BaseModel):
    symbol: str
    overall_sentiment: float = Field(ge=-1.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    key_themes: list[str]
    risk_events: list[str]
    bullish_reasons: list[str]
    bearish_reasons: list[str]
    articles_analyzed: int
    summary: str
    analysis_status: str = "ok"


class NewsAnalysisAgent(BaseAgent):
    """Analyzes fetched news into per-symbol sentiment scores."""

    name = "news_analysis"

    def __init__(self, client: Any = None, model: str = "gpt-4o-mini") -> None:
        self.model = model
        self.client = client or self._build_client()

    def run(self, state: dict) -> dict:
        snapshots = state.get("news_snapshots", [])
        qa_result = state.get("qa_result")
        approved_symbols = self._approved_symbols(qa_result)

        sentiments: dict[str, NewsSentiment] = {}
        if not approved_symbols:
            out = dict(state)
            out["news_sentiments"] = sentiments
            return out

        by_symbol = {self._snapshot_symbol(s): s for s in snapshots if self._snapshot_symbol(s)}

        for symbol in approved_symbols:
            snapshot = by_symbol.get(symbol)
            articles = self._snapshot_articles(snapshot) if snapshot is not None else []

            if len(articles) == 0:
                sentiments[symbol] = self._neutral(
                    symbol,
                    0,
                    "No approved articles available.",
                    status="no_articles",
                )
                continue

            try:
                sentiments[symbol] = self._analyze_symbol(symbol, articles)
            except Exception as exc:
                log.error("NewsAnalysisAgent failed for %s: %s", symbol, exc)
                sentiments[symbol] = self._neutral(
                    symbol,
                    len(articles),
                    "OpenAI failed; defaulting neutral.",
                    status="openai_failed",
                )

        out = dict(state)
        out["news_sentiments"] = sentiments
        return out

    def _analyze_symbol(self, symbol: str, articles: list[dict[str, Any]]) -> NewsSentiment:
        if not self.client:
            raise RuntimeError("OpenAI client unavailable")

        payload = self._build_user_prompt(symbol, articles)
        result = self.client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": payload},
            ],
            response_format=NewsSentiment,
        )
        parsed = result.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("No parsed sentiment returned")
        parsed.analysis_status = "ok"
        return parsed

    @staticmethod
    def _build_user_prompt(symbol: str, articles: list[dict[str, Any]]) -> str:
        lines = [f"Symbol: {symbol}", "Analyze the following recent articles:"]
        for i, article in enumerate(articles[:5], start=1):
            headline = str(article.get("headline", "")).strip()[:200]
            summary = str(article.get("summary", "")).strip()[:200]
            source = str(article.get("source", "")).strip()
            created_at = str(article.get("created_at", "")).strip()
            lines.append(
                f"{i}. [{source}] {headline} | Summary: {summary} | Time: {created_at}"
            )
        lines.append("Return conservative sentiment and explicit risk flags.")
        return "\n".join(lines)

    @staticmethod
    def _neutral(symbol: str, article_count: int, summary: str, status: str = "neutral") -> NewsSentiment:
        return NewsSentiment(
            symbol=symbol,
            overall_sentiment=0.0,
            confidence=0.0,
            key_themes=[],
            risk_events=[],
            bullish_reasons=[],
            bearish_reasons=[],
            articles_analyzed=article_count,
            summary=summary,
            analysis_status=status,
        )

    @staticmethod
    def _approved_symbols(qa_result: Any) -> list[str]:
        if qa_result is None:
            return []
        if isinstance(qa_result, dict):
            approved = qa_result.get("approved_symbols", [])
        else:
            approved = getattr(qa_result, "approved_symbols", [])
        return [str(sym) for sym in approved]

    @staticmethod
    def _snapshot_symbol(snapshot: Any) -> str:
        if snapshot is None:
            return ""
        if isinstance(snapshot, dict):
            return str(snapshot.get("symbol", ""))
        return str(getattr(snapshot, "symbol", ""))

    @staticmethod
    def _snapshot_articles(snapshot: Any) -> list[dict[str, Any]]:
        if snapshot is None:
            return []
        if isinstance(snapshot, dict):
            raw_articles = snapshot.get("articles", [])
        else:
            raw_articles = getattr(snapshot, "articles", [])

        out: list[dict[str, Any]] = []
        for item in raw_articles:
            if isinstance(item, dict):
                out.append(item)
            elif is_dataclass(item):
                out.append(asdict(item))
            else:
                out.append({
                    "headline": getattr(item, "headline", ""),
                    "summary": getattr(item, "summary", ""),
                    "source": getattr(item, "source", ""),
                    "created_at": getattr(item, "created_at", ""),
                })
        return out

    @staticmethod
    def _build_client() -> Any:
        if not settings.openai_api_key:
            return None
        try:
            from openai import OpenAI

            return OpenAI(api_key=settings.openai_api_key)
        except Exception as exc:
            log.error("Failed to initialize OpenAI client: %s", exc)
            return None
