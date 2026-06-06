"""Agent package exports."""

from agents.base_agent import BaseAgent
from agents.market_data_agent import MarketDataFetcherAgent, MarketSnapshot
from agents.data_qa_agent import DataQAAgent, QAResult
from agents.news_fetcher_agent import NewsFetcherAgent, NewsSnapshot, NewsArticle
from agents.news_analysis_agent import NewsAnalysisAgent, NewsSentiment
from agents.signal_selection_agent import SignalSelectionAgent, SignalSelectionResult
from agents.risk_agent import RiskCapitalAllocationAgent, RiskAllocation

try:
    from agents.orchestrator import AgentOrchestrator
except Exception:  # pragma: no cover - optional import when langgraph unavailable
    AgentOrchestrator = None

__all__ = [
    "BaseAgent",
    "MarketDataFetcherAgent", "MarketSnapshot",
    "DataQAAgent", "QAResult",
    "NewsFetcherAgent", "NewsSnapshot", "NewsArticle",
    "NewsAnalysisAgent", "NewsSentiment",
    "SignalSelectionAgent", "SignalSelectionResult",
    "RiskCapitalAllocationAgent", "RiskAllocation",
    "AgentOrchestrator",
]
