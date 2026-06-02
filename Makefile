up:
	docker-compose up --build

down:
	docker-compose down

logs:
	docker-compose logs -f

test:
	docker-compose run --rm strategy python -m pytest strategy/tests/ -v

shell:
	docker-compose run --rm strategy bash

prod-up:
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

prod-down:
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
