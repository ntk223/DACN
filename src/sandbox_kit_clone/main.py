"""Điểm vào chạy server: ``make run`` hoặc ``python -m sandbox_kit_clone.main``."""

from __future__ import annotations

from pathlib import Path

import uvicorn

from sandbox_kit_clone.config import get_settings
from sandbox_kit_clone.gateway.app import create_app


def main() -> None:
    """Dựng app rồi chạy uvicorn trực tiếp (lifespan FastMCP chạy đúng)."""
    settings = get_settings()
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    app = create_app(settings)
    base = f"http://{settings.host}:{settings.port}"
    print("Sandbox Kit Clone (W2) đang chạy:")
    print(f"  - MCP endpoint : {base}/mcp   (transport streamable-http)")
    print(f"  - Upload       : {base}/upload")
    print(f"  - Health       : {base}/health")
    print(f"  - Quản trị     : {base}/admin")
    print(f"  - Provider     : {settings.provider} (image {settings.sandbox_image})")
    print(f"  - Thư mục dữ liệu: {Path(settings.data_dir).resolve()}")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
