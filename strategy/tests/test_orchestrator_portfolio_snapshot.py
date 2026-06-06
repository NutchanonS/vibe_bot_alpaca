"""Tests for portfolio snapshot loading in AgentOrchestrator."""

from __future__ import annotations

import importlib
import sys
import types


def _import_orchestrator_module():
    # Test env may not have langgraph installed. Stub minimal API to import module.
    if "langgraph.graph" not in sys.modules:
        graph_module = types.ModuleType("langgraph.graph")
        graph_module.END = "END"

        class _DummyStateGraph:
            def __init__(self, *_args, **_kwargs):
                pass

            def add_node(self, *_args, **_kwargs):
                return None

            def set_entry_point(self, *_args, **_kwargs):
                return None

            def add_edge(self, *_args, **_kwargs):
                return None

            def compile(self):
                class _DummyGraph:
                    @staticmethod
                    def invoke(state):
                        return state

                return _DummyGraph()

        graph_module.StateGraph = _DummyStateGraph

        langgraph_module = types.ModuleType("langgraph")
        langgraph_module.graph = graph_module
        sys.modules["langgraph"] = langgraph_module
        sys.modules["langgraph.graph"] = graph_module

    if "broker.alpaca_client" not in sys.modules:
        broker_module = types.ModuleType("broker")
        alpaca_client_module = types.ModuleType("broker.alpaca_client")

        class _DummyAlpaca:
            def get_account(self):
                return type("A", (), {"equity": 0, "cash": 0, "buying_power": 0})()

            def get_positions(self):
                return []

        alpaca_client_module.alpaca = _DummyAlpaca()
        sys.modules["broker"] = broker_module
        sys.modules["broker.alpaca_client"] = alpaca_client_module

    if "agents.orchestrator" in sys.modules:
        del sys.modules["agents.orchestrator"]

    return importlib.import_module("agents.orchestrator")


class _FakeAccount:
    equity = "125000.50"
    cash = "40000.25"
    buying_power = "80000.75"


class _FakePosition:
    def __init__(self, symbol: str, qty: str):
        self.symbol = symbol
        self.qty = qty
        self.avg_entry_price = "100.0"
        self.current_price = "110.0"
        self.market_value = "1100.0"
        self.unrealized_pl = "100.0"
        self.unrealized_plpc = "0.10"


class _FakeAlpacaOK:
    def get_account(self):
        return _FakeAccount()

    def get_positions(self):
        return [_FakePosition("AAPL", "10"), _FakePosition("SPY", "5")]


class _FakeAlpacaFail:
    def get_account(self):
        raise RuntimeError("down")

    def get_positions(self):
        return []


def test_load_portfolio_snapshot_adds_normalized_portfolio(monkeypatch):
    orchestrator_module = _import_orchestrator_module()
    AgentOrchestrator = orchestrator_module.AgentOrchestrator
    monkeypatch.setattr(orchestrator_module, "alpaca", _FakeAlpacaOK())

    state = AgentOrchestrator._load_portfolio_snapshot({"trigger": "test"})
    portfolio = state["portfolio"]

    assert portfolio["equity"] == 125000.5
    assert portfolio["cash"] == 40000.25
    assert portfolio["buying_power"] == 80000.75
    assert len(portfolio["positions"]) == 2
    assert portfolio["positions"][0]["symbol"] == "AAPL"
    assert portfolio["positions"][0]["qty"] == 10.0


def test_load_portfolio_snapshot_falls_back_to_zeros_on_error(monkeypatch):
    orchestrator_module = _import_orchestrator_module()
    AgentOrchestrator = orchestrator_module.AgentOrchestrator
    monkeypatch.setattr(orchestrator_module, "alpaca", _FakeAlpacaFail())

    state = AgentOrchestrator._load_portfolio_snapshot({"trigger": "test"})
    portfolio = state["portfolio"]

    assert portfolio["equity"] == 0.0
    assert portfolio["cash"] == 0.0
    assert portfolio["buying_power"] == 0.0
    assert portfolio["positions"] == []


def test_status_payload_includes_portfolio_summary():
    orchestrator_module = _import_orchestrator_module()
    AgentOrchestrator = orchestrator_module.AgentOrchestrator
    orchestrator = AgentOrchestrator.__new__(AgentOrchestrator)
    status = orchestrator._build_status_payload(
        {
            "trigger": "manual",
            "symbols": ["AAPL"],
            "portfolio": {
                "equity": 50000.0,
                "cash": 12000.0,
                "buying_power": 18000.0,
                "positions": [{"symbol": "AAPL", "qty": 2}],
            },
            "market_snapshots": [],
            "news_snapshots": [],
            "news_sentiments": {},
            "signal_selections": {},
            "risk_allocations": {},
        }
    )

    assert status["portfolio"]["equity"] == 50000.0
    assert status["portfolio"]["cash"] == 12000.0
    assert status["portfolio"]["buying_power"] == 18000.0
    assert status["portfolio"]["positions_count"] == 1
