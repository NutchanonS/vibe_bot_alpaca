# Alpaca Trading Bot

![alt text](./readme_img/image.png)

![alt text](./readme_img/image-5.png)

![alt text](./readme_img/image-4.png)

Automated trading bot platform with:
- Python strategy engine (`strategy/`)
- Node.js backend API + WebSocket relay (`backend/`)
- React dashboard (`frontend/`)
- PostgreSQL + Redis + Nginx via Docker Compose

## Tech Stack

- **Strategy:** Python 3.12, `alpaca-py`, `apscheduler`, `pandas`
- **Backend:** Node.js 20, Express, Socket.IO, Redis, PostgreSQL (`pg`)
- **Frontend:** React + TypeScript + Vite + TailwindCSS + lightweight-charts
- **Infra:** Docker Compose, Nginx reverse proxy
![alt text](./readme_img/image-2.png)

## Repository Structure

```text
.
├── strategy/         # Trading engine and strategies
├── backend/          # REST API, auth, WebSocket relay
├── frontend/         # Dashboard UI
├── db/               # PostgreSQL schema bootstrap
├── nginx/            # Reverse proxy config
├── docker-compose.yml
└── docker-compose.prod.yml
```

## Prerequisites

- Docker Desktop (recommended)
- Or local runtimes: Python 3.12+, Node.js 20+, PostgreSQL, Redis

## Quick Start (Docker)

1. Copy env template:

```bash
cp .env.example .env
```

2. Update `.env` with your Alpaca keys and secrets.

3. Start all services:

```bash
docker compose up --build
```

4. Open apps:
- `http://localhost` (via Nginx)
- `http://localhost:3000` (frontend dev)
- `http://localhost:8000/health` (backend health)

## Common Commands

```bash
# Stop services
docker compose down

# Follow logs
docker compose logs -f

# Run strategy tests in container
docker compose run --rm strategy python -m pytest tests -v

# Start with production overrides
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

If you use the `Makefile`, equivalent shortcuts are available:

```bash
make up
make down
make logs
make test
make prod-up
```

## Environment Variables

Key variables (see `.env.example` for full list):

- `ALPACA_MODE` (`sandbox` or `production`)
- `ALPACA_PAPER_API_KEY`, `ALPACA_PAPER_SECRET_KEY`
- `ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_SECRET_KEY`
- `BACKEND_PORT`, `FRONTEND_PORT`
- `POSTGRES_*`, `REDIS_*`
- `DEFAULT_STRATEGIES`, `MAX_POSITION_SIZE_PCT`, `MAX_DRAWDOWN_PCT`

## Strategy Notes

Built-in strategies:
- RSI Mean Reversion
- EMA Crossover
- VWAP Breakout

All strategy signals are executed through `strategy/broker/order_manager.py`.

![alt text](./readme_img/image-3.png)

## Security Notes

- Do not commit real API keys or secrets.
- Keep `.env` local only.
- Rotate keys if they were ever exposed.

## Development Notes

- Backend routes are under `backend/src/routes/`.
- Frontend pages are under `frontend/src/pages/`.
- Strategy scheduling entrypoint: `strategy/main.py`.
- Health endpoint: `GET /health` on backend.

## License

Internal/project-specific unless otherwise specified.
