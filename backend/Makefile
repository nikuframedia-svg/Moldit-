.PHONY: dev test lint format install

install:
	pip install -e ".[dev]"

dev:
	uvicorn src.main:app --reload --port 8000

test:
	python -m pytest tests/ -x -q

lint:
	ruff check src/ tests/

format:
	ruff format src/ tests/
	ruff check src/ tests/ --fix
