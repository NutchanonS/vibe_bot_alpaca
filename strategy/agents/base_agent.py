"""Base interfaces for agentic workflow components."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseAgent(ABC):
    """Abstract agent contract used by the orchestrator."""

    name: str

    @abstractmethod
    def run(self, state: dict) -> dict:
        """Execute one agent step and return updated state."""
        raise NotImplementedError
