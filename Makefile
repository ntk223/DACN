.PHONY: all test lint run clean

all: lint test

test:
	PYTHONPATH=src pytest tests/ -q

lint:
	PYTHONPATH=src ruff check src tests

run:
	PYTHONPATH=src python -m sandbox_kit_clone.main

clean:
	rm -rf data .pytest_cache .ruff_cache
