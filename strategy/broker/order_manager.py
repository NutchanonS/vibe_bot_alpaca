"""Order placement, tracking, and cancellation through AlpacaClient."""

from __future__ import annotations

from typing import Optional
import psycopg2
from alpaca.trading.models import Order

from broker.alpaca_client import alpaca
from config import settings
from utils.logger import get_logger

log = get_logger(__name__)


def _get_db():
    return psycopg2.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        dbname=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )


class OrderManager:
    def place_market_order(self, symbol: str, qty: float, side: str, strategy: str = "") -> Optional[Order]:
        try:
            order = alpaca.place_order(symbol=symbol, qty=qty, side=side, order_type="market")
            self._persist_order(order, strategy)
            return order
        except Exception as exc:
            log.error("Failed to place market order %s %s %s: %s", side, symbol, qty, exc)
            return None

    def place_limit_order(
        self, symbol: str, qty: float, side: str, limit_price: float, strategy: str = ""
    ) -> Optional[Order]:
        try:
            order = alpaca.place_order(
                symbol=symbol, qty=qty, side=side, order_type="limit", limit_price=limit_price
            )
            self._persist_order(order, strategy)
            return order
        except Exception as exc:
            log.error("Failed to place limit order: %s", exc)
            return None

    def cancel_order(self, order_id: str) -> bool:
        try:
            alpaca.cancel_order(order_id)
            return True
        except Exception as exc:
            log.error("Failed to cancel order %s: %s", order_id, exc)
            return False

    def _persist_order(self, order: Order, strategy: str) -> None:
        try:
            conn = _get_db()
            with conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO orders (alpaca_order_id, symbol, side, qty, type, status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (alpaca_order_id) DO NOTHING
                    """,
                    (
                        str(order.id),
                        order.symbol,
                        order.side.value,
                        float(order.qty),
                        order.order_type.value,
                        order.status.value,
                    ),
                )
            conn.close()
        except Exception as exc:
            log.warning("DB persist failed for order %s: %s", order.id, exc)


order_manager = OrderManager()
