"""Abstract base for all technical indicators."""

from abc import ABC, abstractmethod
import pandas as pd


class BaseIndicator(ABC):
    @abstractmethod
    def compute(self, df: pd.DataFrame) -> pd.Series:
        """Compute the indicator and return as a named Series."""
        ...
