"""App FastAPI chính (W1.5): REST upload/download + MCP streamable-http trên cùng tiến trình.

Dựng app: ``create_app()`` → Manager + FastMCP (stateless) + router upload/download +
handler lỗi chuẩn + ``/health``. MCP được mount tại ``/mcp`` — agent kết nối
``http://{host}:{port}/mcp`` (transport streamable-http, không trạng thái).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from mcp.server.fastmcp import FastMCP

from sandbox_kit_clone import __version__
from sandbox_kit_clone.config import Settings, get_settings
from sandbox_kit_clone.gateway import (
    download_router,
    install_error_handlers,
    upload_router,
)
from sandbox_kit_clone.gateway.admin_api import admin_api_router
from sandbox_kit_clone.gateway.admin_sandbox_api import admin_sandbox_router
from sandbox_kit_clone.gateway.mcp_server import register_tools
from sandbox_kit_clone.manager.manager import Manager
from sandbox_kit_clone.providers.base import SandboxProvider
from sandbox_kit_clone.providers.factory import get_provider

# Tên MCP server hiển thị cho client (Inspector / Claude Code...).
MCP_SERVER_NAME = "sandbox-kit-clone"

# Giao diện quản trị (dev tool): SPA React, build sẵn trong ``web/dist`` (make web).
WEB_DIST_DIR = Path(__file__).parents[3] / "web" / "dist"


def create_app(
    settings: Settings | None = None,
    provider: SandboxProvider | None = None,
) -> FastAPI:
    """Dựng app hoàn chỉnh: REST (upload/download/health) + MCP mount tại ``/mcp``.

    ``settings``/``provider`` truyền vào cho test; mặc định đọc cấu hình env và chọn
    provider theo ``SANDBOX_KIT_PROVIDER`` (fake | docker).
    """
    settings = settings or get_settings()
    provider = provider or get_provider(settings)
    manager = Manager(settings, provider)

    # streamable_http_path="/" để mount tại "/mcp" ra đúng URL /mcp (không nhân đôi).
    mcp = FastMCP(MCP_SERVER_NAME, stateless_http=True, streamable_http_path="/")
    tool_fns = register_tools(mcp, manager)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # FastMCP cần session manager chạy suốt đời app (mẫu mount chính thức).
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title=MCP_SERVER_NAME, version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.provider = provider
    app.state.manager = manager
    app.state.mcp = mcp
    app.state.tool_fns = tool_fns  # test gọi tool trực tiếp, không cần transport MCP

    @app.get("/health")
    def health() -> dict:
        """Kiểm tra sống: app chạy + phiên bản."""
        return {"status": "ok", "version": __version__}

    @app.get("/admin", include_in_schema=False)
    def admin() -> RedirectResponse:
        """Chuyển hướng sang ``/admin/`` — đường dẫn asset tương đối (``./assets/…``)
        trong index.html chỉ đúng khi URL kết thúc bằng ``/``."""
        return RedirectResponse("/admin/", status_code=307)

    @app.get("/admin/", include_in_schema=False)
    def admin_index() -> HTMLResponse:
        """Giao diện quản trị (SPA React — build trong ``web/dist``)."""
        index = WEB_DIST_DIR / "index.html"
        if index.is_file():
            return HTMLResponse(index.read_text(encoding="utf-8"))
        # Chưa build web (make web) — trả trang nhắc lệnh thay vì 404.
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><title>Sandbox Kit</title>"
            "<p style='font-family:system-ui;padding:2rem'>Chưa có bản build giao diện quản trị."
            "<br>Chạy <code>make web</code> rồi tải lại trang.</p>"
        )

    if (WEB_DIST_DIR / "assets").is_dir():
        app.mount("/admin/assets", StaticFiles(directory=WEB_DIST_DIR / "assets"))

    app.include_router(upload_router)
    app.include_router(download_router)
    app.include_router(admin_api_router)
    app.include_router(admin_sandbox_router)

    # Route cũ (/admin/vfs, /admin/sandboxes) — gộp về một trang duy nhất.
    # Đặt SAU các router /admin/api/* để không nuốt request API.
    @app.get("/admin/{rest:path}", include_in_schema=False)
    def admin_legacy(rest: str) -> RedirectResponse:
        return RedirectResponse("/admin/", status_code=302)
    install_error_handlers(app)
    app.mount("/mcp", mcp.streamable_http_app())
    return app
