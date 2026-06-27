"""Alpaca REST + WebSocket wrapper using alpaca-py."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

import pandas as pd
from alpaca.data import StockHistoricalDataClient
from alpaca.data.live import StockDataStream
from alpaca.data.requests import StockBarsRequest
from alpaca.data.enums import DataFeed
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, OrderType, TimeInForce
from alpaca.trading.requests import (
    MarketOrderRequest, LimitOrderRequest, StopOrderRequest,
    TakeProfitRequest, StopLossRequest,
)
from alpaca.trading.enums import OrderClass
from alpaca.trading.models import TradeAccount, Position, Order

from config import settings
from utils.logger import get_logger

log = get_logger(__name__)

_TIMEFRAME_MAP: dict[str, TimeFrame] = {
    "1Min": TimeFrame(1, TimeFrameUnit.Minute),
    "5Min": TimeFrame(5, TimeFrameUnit.Minute),
    "15Min": TimeFrame(15, TimeFrameUnit.Minute),
    "1Hour": TimeFrame(1, TimeFrameUnit.Hour),
    "1Day": TimeFrame(1, TimeFrameUnit.Day),
}


class AlpacaClient:
    def __init__(self) -> None:
        self._trading = TradingClient(
            api_key=settings.api_key,
            secret_key=settings.secret_key,
            paper=(settings.mode != "production"),
        )
        self._data = StockHistoricalDataClient(
            api_key=settings.api_key,
            secret_key=settings.secret_key,
        )
        self._stream: Optional[StockDataStream] = None
        log.info("AlpacaClient initialized in %s mode", settings.mode)

    # --- Account ---

    def get_account(self) -> TradeAccount:
        return self._trading.get_account()

    # --- Market Data ---

    def get_bars(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 100,
        start: "datetime | str | None" = None,
        end: "datetime | str | None" = None,
    ) -> pd.DataFrame:
        """Return OHLCV DataFrame for the given symbol and timeframe string."""
        tf = _TIMEFRAME_MAP.get(timeframe)
        if tf is None:
            raise ValueError(f"Unknown timeframe '{timeframe}'. Valid: {list(_TIMEFRAME_MAP)}")

        if isinstance(start, str):
            start = datetime.fromisoformat(start.rstrip("Z")).replace(tzinfo=timezone.utc)
        if isinstance(end, str):
            end = datetime.fromisoformat(end.rstrip("Z")).replace(tzinfo=timezone.utc)

        req = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=tf,
            limit=limit,
            start=start or datetime.now(timezone.utc) - timedelta(days=7),
            end=end,
            feed=DataFeed.IEX,
        )
        bars = self._data.get_stock_bars(req)
        df = bars.df
        if isinstance(df.index, pd.MultiIndex):
            df = df.xs(symbol, level="symbol")
        return df.reset_index()

    # --- Positions ---

    def get_positions(self) -> list[Position]:
        return self._trading.get_all_positions()

    def get_position(self, symbol: str) -> Optional[Position]:
        try:
            return self._trading.get_open_position(symbol)
        except Exception:
            return None

    # --- Orders ---

    def place_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        order_type: str = "market",
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
    ) -> Order:
        order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL

        if order_type == "market":
            req = MarketOrderRequest(
                symbol=symbol,
                qty=qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
            )
        elif order_type == "limit":
            if limit_price is None:
                raise ValueError("limit_price required for limit orders")
            req = LimitOrderRequest(
                symbol=symbol,
                qty=qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
                limit_price=limit_price,
            )
        elif order_type == "stop":
            if stop_price is None:
                raise ValueError("stop_price required for stop orders")
            req = StopOrderRequest(
                symbol=symbol,
                qty=qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
                stop_price=stop_price,
            )
        else:
            raise ValueError(f"Unknown order_type '{order_type}'")

        order = self._trading.submit_order(req)
        log.info("Order placed: %s %s %s qty=%s", order_type, side, symbol, qty)
        return order

    def place_bracket_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        stop_loss: float,
        take_profit: float,
    ) -> Order:
        """Submit a bracket order (entry + stop-loss + take-profit in one request)."""
        order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
        req = MarketOrderRequest(
            symbol=symbol,
            qty=qty,
            side=order_side,
            time_in_force=TimeInForce.DAY,
            order_class=OrderClass.BRACKET,
            take_profit=TakeProfitRequest(limit_price=round(float(take_profit), 2)),
            stop_loss=StopLossRequest(stop_price=round(float(stop_loss), 2)),
        )
        order = self._trading.submit_order(req)
        log.info("Bracket order placed: %s %s qty=%s SL=%.2f TP=%.2f",
                 side, symbol, qty, stop_loss, take_profit)
        return order

    def cancel_order(self, order_id: str) -> None:
        self._trading.cancel_order_by_id(order_id)
        log.info("Order cancelled: %s", order_id)

    def get_orders(self, status: str = "open") -> list[Order]:
        from alpaca.trading.requests import GetOrdersRequest
        from alpaca.trading.enums import QueryOrderStatus
        status_map = {
            "open": QueryOrderStatus.OPEN,
            "closed": QueryOrderStatus.CLOSED,
            "all": QueryOrderStatus.ALL,
        }
        req = GetOrdersRequest(status=status_map.get(status, QueryOrderStatus.OPEN))
        return self._trading.get_orders(req)

    # --- Streaming ---

    def stream_quotes(self, symbols: list[str], callback: Callable) -> None:
        """Start async quote stream; calls callback(quote) for each tick."""
        self._stream = StockDataStream(
            api_key=settings.api_key,
            secret_key=settings.secret_key,
        )
        self._stream.subscribe_quotes(callback, *symbols)
        log.info("Starting quote stream for: %s", symbols)
        self._stream.run()

    def stop_stream(self) -> None:
        if self._stream:
            self._stream.stop()


# Module-level singleton
alpaca = AlpacaClient()
