-- PostgreSQL schema for Alpaca Trading Bot

CREATE TABLE IF NOT EXISTS trades (
    id              SERIAL PRIMARY KEY,
    symbol          VARCHAR(10) NOT NULL,
    side            VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    qty             NUMERIC(18, 4) NOT NULL,
    price           NUMERIC(18, 4) NOT NULL,
    filled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    strategy        VARCHAR(64),
    pnl             NUMERIC(18, 4)
);

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    alpaca_order_id VARCHAR(64) UNIQUE NOT NULL,
    symbol          VARCHAR(10) NOT NULL,
    side            VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    qty             NUMERIC(18, 4) NOT NULL,
    type            VARCHAR(16) NOT NULL DEFAULT 'market',
    status          VARCHAR(32) NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_value     NUMERIC(18, 4) NOT NULL,
    cash            NUMERIC(18, 4) NOT NULL,
    positions_json  JSONB
);

CREATE TABLE IF NOT EXISTS strategy_signals (
    id              SERIAL PRIMARY KEY,
    strategy_name   VARCHAR(64) NOT NULL,
    symbol          VARCHAR(10) NOT NULL,
    signal          VARCHAR(8) NOT NULL CHECK (signal IN ('buy', 'sell', 'hold')),
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_filled_at ON trades(filled_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_signals_strategy ON strategy_signals(strategy_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON portfolio_snapshots(timestamp);
