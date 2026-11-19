# Image sandbox PoC (poc-plan §3): python-slim + bộ công cụ + trình thực thi gRPC.
# Build từ GỐC repo: `make image` (= docker build -f sandbox-image/Dockerfile .)
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Phiên bản khớp code sinh từ proto (grpcio-tools 1.83.1 / protobuf 7.x).
RUN pip install --no-cache-dir "grpcio==1.83.1" "protobuf==7.36.1"

# Chỉ chép package agent (không kéo theo phần còn lại của server).
COPY src/sandbox_kit_clone/__init__.py /opt/skc/sandbox_kit_clone/__init__.py
COPY src/sandbox_kit_clone/agent /opt/skc/sandbox_kit_clone/agent
ENV PYTHONPATH=/opt/skc PYTHONUNBUFFERED=1

RUN mkdir -p /workspace /scratch
WORKDIR /workspace
EXPOSE 50051

LABEL sandbox-kit.image="w2" sandbox-kit.agent="w2.1"
CMD ["python", "-m", "sandbox_kit_clone.agent", "--root", "/workspace", "--port", "50051"]
