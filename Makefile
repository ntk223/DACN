.PHONY: all test lint run clean init-db seed seed-big reset-db

all: lint test

test:
	PYTHONPATH=src pytest tests/ -q

lint:
	PYTHONPATH=src ruff check src tests

run:
	PYTHONPATH=src python -m sandbox_kit_clone.main

init-db:   ## tạo system.sqlite (idempotent)
	python3 scripts/init_db.py

seed:      ## nạp workspace mẫu cho từng thuật toán + tự kiểm
	python3 scripts/init_db.py --seed

seed-big:  ## như seed + file 33MB đi đường file rời
	python3 scripts/init_db.py --seed --big

reset-db:  ## XÓA data/ rồi nạp lại mẫu (dừng server trước)
	python3 scripts/init_db.py --reset --seed

clean:
	rm -rf data .pytest_cache .ruff_cache
