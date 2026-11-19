.PHONY: all test lint run run-docker image proto test-docker clean init-db seed seed-big reset-db

all: lint test

test:
	PYTHONPATH=src pytest tests/ -q

lint:
	PYTHONPATH=src ruff check src tests

run:
	PYTHONPATH=src python -m sandbox_kit_clone.main

run-docker:  ## server dùng provider Docker (cần `make image` trước)
	SANDBOX_KIT_PROVIDER=docker PYTHONPATH=src python -m sandbox_kit_clone.main

proto:     ## sinh lại code gRPC từ agent/proto/sandbox_agent.proto (cần grpcio-tools)
	cd src && python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. --pyi_out=. \
		sandbox_kit_clone/agent/proto/sandbox_agent.proto

image:     ## build image sandbox sandbox-kit/sandbox:w2
	docker build -t sandbox-kit/sandbox:w2 -f sandbox-image/Dockerfile .

test-docker:  ## chỉ chạy test cần Docker thật
	PYTHONPATH=src pytest tests/ -q -m docker

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
