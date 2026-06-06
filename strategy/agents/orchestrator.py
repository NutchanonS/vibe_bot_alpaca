"""LangGraph orchestrator for the agentic trading pipeline."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime, timezone
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from agents.data_qa_agent import DataQAAgent
from agents.market_data_agent import MarketDataFetcherAgent
from agents.news_analysis_agent import NewsAnalysisAgent
from agents.news_fetcher_agent import NewsFetcherAgent
from agents.signal_selection_agent import SignalSelectionAgent


class AgentState(TypedDict, total=False):
    symbols: list[str]
    lookback: int
    timeframe: str
    lookback_hours: int
    limit_per_symbol: int
    trigger: str
    run_started_at: str

    market_snapshots: list[Any]
    qa_result: Any
    news_snapshots: list[Any]
    news_sentiments: dict[str, Any]
    signal_selections: dict[str, Any]


class AgentOrchestrator:
    """Runs the full agent chain and returns final state + status payload."""

    def __init__(self) -> None:
        self.market_data_agent = MarketDataFetcherAgent()
        self.data_qa_agent = DataQAAgent()
        self.news_fetcher_agent = NewsFetcherAgent()
        self.news_analysis_agent = NewsAnalysisAgent()
        self.signal_selection_agent = SignalSelectionAgent()
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(AgentState)

        graph.add_node("market_data", self.market_data_agent.run)
        graph.add_node("data_qa", self.data_qa_agent.run)
        graph.add_node("news_fetch", self.news_fetcher_agent.run)
        graph.add_node("news_analysis", self.news_analysis_agent.run)
        graph.add_node("signal_selection", self.signal_selection_agent.run)

        graph.set_entry_point("market_data")
        graph.add_edge("market_data", "data_qa")
        graph.add_edge("data_qa", "news_fetch")
        graph.add_edge("news_fetch", "news_analysis")
        graph.add_edge("news_analysis", "signal_selection")
        graph.add_edge("signal_selection", END)

        return graph.compile()

    def run(self, *, symbols: list[str], trigger: str = "scheduled") -> tuple[dict, dict]:
        state: AgentState = {
            "symbols": symbols,
            "lookback": 50,
            "timeframe": "15Min",
            "lookback_hours": 24,
            "limit_per_symbol": 10,
            "trigger": trigger,
            "run_started_at": datetime.now(timezone.utc).isoformat(),
        }
        final_state = self._graph.invoke(state)
        status = self._build_status_payload(final_state)
        return final_state, status

    def _build_status_payload(self, state: dict) -> dict:
        qa_result = state.get("qa_result")
        market_snapshots = state.get("market_snapshots", [])
        news_snapshots = state.get("news_snapshots", [])
        news_sentiments = state.get("news_sentiments", {})
        signal_selections = state.get("signal_selections", {})

        return {
            "status": "ok",
            "trigger": state.get("trigger", "scheduled"),
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "symbols": state.get("symbols", []),
            "market": {
                "count": len(market_snapshots),
                "snapshots": [
                    {
                        "symbol": getattr(s, "symbol", None),
                        "latest_price": getattr(s, "latest_price", None),
                        "data_quality_score": getattr(s, "data_quality_score", None),
                        "avg_volume_20": getattr(s, "avg_volume_20", None),
                        "indicators": getattr(s, "indicators", {}),
                    }
                    for s in market_snapshots
                ],
            },
            "qa": self._to_plain(qa_result),
            "news": {
                "count": len(news_snapshots),
                "snapshots": [
                    {
                        "symbol": getattr(s, "symbol", None),
                        "articles": len(getattr(s, "articles", [])),
                        "items": [
                            {
                                "id": getattr(a, "id", None),
                                "headline": getattr(a, "headline", ""),
                                "summary": getattr(a, "summary", ""),
                                "source": getattr(a, "source", ""),
                                "url": getattr(a, "url", ""),
                                "created_at": AgentOrchestrator._to_plain(getattr(a, "created_at", None)),
                            }
                            for a in getattr(s, "articles", [])[:5]
                        ],
                    }
                    for s in news_snapshots
                ],
            },
            "news_sentiments": {
                sym: self._to_plain(sentiment)
                for sym, sentiment in news_sentiments.items()
            },
            "signal_selections": {
                sym: self._to_plain(sel)
                for sym, sel in signal_selections.items()
            },
        }

    @staticmethod
    def _to_plain(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if hasattr(value, "model_dump"):
            return value.model_dump()
        if is_dataclass(value):
            return AgentOrchestrator._to_plain(asdict(value))
        if isinstance(value, dict):
            return {k: AgentOrchestrator._to_plain(v) for k, v in value.items()}
        if isinstance(value, list):
            return [AgentOrchestrator._to_plain(v) for v in value]
        return value
