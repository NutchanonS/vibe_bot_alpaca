"""News analysis agent (Step 2b) — two-pass: summarize all N articles, then score.

Pass 1 (summarize): feeds up to 20 articles → compact bullet-point summary
Pass 2 (score):     feeds the summary → structured NewsSentiment output

Cost vs. old single-pass: ~2 LLM calls regardless of N (vs. 1 call but capped at 5 articles).
Falls back to single-pass automatically if summarization fails.
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any

from pydantic import BaseModel, Field

from agents.base_agent import BaseAgent
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

# Kept constant for prompt-caching benefit
SUMMARIZE_SYSTEM_PROMPT = (
    "You are a financial news summarizer. Given news articles about a stock, "
    "extract only the most market-relevant facts into concise bullet points. "
    "Focus on concrete events, earnings, guidance, legal/regulatory news, or "
    "macro factors that could move the stock price. Be factual, not speculative."
)

SCORE_SYSTEM_PROMPT = (
    "You are a financial news analyst. Given a bullet-point summary of recent "
    "news about a stock, extract sentiment signals. Be precise and conservative."
)


class ArticleSummary(BaseModel):
    bullet_points: list[str]  # key market-relevant facts, max 10


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
    """Analyzes fetched news into per-symbol sentiment scores (two-pass)."""

    name = "news_analysis"

    def __init__(self, client: Any = None, model: str = "gpt-4o-mini") -> None:
        self.model  = model
        self.client = client or self._build_client()

    # ── BaseAgent contract ────────────────────────────────────────────────────

    def run(self, state: dict) -> dict:
        snapshots        = state.get("news_snapshots", [])
        qa_result        = state.get("qa_result")
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
                sentiments[symbol] = self._neutral(symbol, 0, "No approved articles available.", status="no_articles")
                continue

            try:
                sentiments[symbol] = self._analyze_symbol(symbol, articles)
            except Exception as exc:
                log.error("NewsAnalysisAgent failed for %s: %s", symbol, exc)
                sentiments[symbol] = self._neutral(symbol, len(articles), "OpenAI failed; defaulting neutral.", status="openai_failed")

        out = dict(state)
        out["news_sentiments"] = sentiments
        return out

    # ── Two-pass analysis ────────────────────────────────────────────────────

    def _analyze_symbol(self, symbol: str, articles: list[dict[str, Any]]) -> NewsSentiment:
        if not self.client:
            raise RuntimeError("OpenAI client unavailable")

        # Pass 1: summarize all N articles into bullet points
        bullet_summary = self._summarize_articles(symbol, articles)

        # Pass 2: score from the summary (or fall back to raw articles)
        if bullet_summary:
            payload = (
                f"Symbol: {symbol}\n"
                f"Condensed summary of {len(articles)} recent news article(s):\n"
                f"{bullet_summary}\n\n"
                "Based on this summary, provide sentiment analysis with conservative scoring "
                "and explicit risk flags."
            )
            analysis_status = "two_pass"
        else:
            # Fallback: single-pass with raw articles (old behaviour)
            payload          = self._build_user_prompt(symbol, articles)
            analysis_status  = "single_pass"

        result = self.client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SCORE_SYSTEM_PROMPT},
                {"role": "user",   "content": payload},
            ],
            response_format=NewsSentiment,
        )
        parsed = result.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("No parsed sentiment returned")
        parsed.analysis_status = analysis_status
        return parsed

    def _summarize_articles(self, symbol: str, articles: list[dict[str, Any]]) -> str:
        """Pass 1: summarize up to 20 articles into bullet points. Returns empty string on failure."""
        if not self.client or not articles:
            return ""

        lines = [
            f"Summarize these {len(articles)} news article(s) about {symbol}.",
            "Output up to 8 bullet points covering only facts that could affect the stock price.",
            "Articles (newest first):",
        ]
        for i, article in enumerate(articles[:20], start=1):
            headline   = str(article.get("headline",   "")).strip()[:200]
            summary    = str(article.get("summary",    "")).strip()[:150]
            source     = str(article.get("source",     "")).strip()
            created_at = str(article.get("created_at", "")).strip()[:16]
            lines.append(f"{i}. [{source} {created_at}] {headline}. {summary}")

        try:
            result = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[
                    {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
                    {"role": "user",   "content": "\n".join(lines)},
                ],
                response_format=ArticleSummary,
            )
            parsed = result.choices[0].message.parsed
            if parsed and parsed.bullet_points:
                return "\n".join(f"• {bp}" for bp in parsed.bullet_points)
        except Exception as exc:
            log.warning("Article summarization failed for %s: %s", symbol, exc)
        return ""

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _build_user_prompt(symbol: str, articles: list[dict[str, Any]]) -> str:
        """Single-pass fallback: feed raw articles directly (capped at 5)."""
        lines = [f"Symbol: {symbol}", "Analyze the following recent articles:"]
        for i, article in enumerate(articles[:5], start=1):
            headline   = str(article.get("headline",   "")).strip()[:200]
            summary    = str(article.get("summary",    "")).strip()[:200]
            source     = str(article.get("source",     "")).strip()
            created_at = str(article.get("created_at", "")).strip()
            lines.append(f"{i}. [{source}] {headline} | Summary: {summary} | Time: {created_at}")
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
                    "headline":   getattr(item, "headline",   ""),
                    "summary":    getattr(item, "summary",    ""),
                    "source":     getattr(item, "source",     ""),
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
