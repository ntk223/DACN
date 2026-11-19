# Image sandbox PoC (poc-plan §3): python-slim + bộ công cụ cơ bản.
# W2 bước sau sẽ thêm trình thực thi gRPC làm tiến trình chính; hiện container chỉ giữ sống.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace /scratch
WORKDIR /workspace

LABEL sandbox-kit.image="w2"
CMD ["sleep", "infinity"]
