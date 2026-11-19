"""App FastAPI chính (W1.5): REST upload/download + MCP streamable-http trên cùng tiến trình.

Dựng app: ``create_app()`` → Manager + FastMCP (stateless) + router upload/download +
handler lỗi chuẩn + ``/health``. MCP được mount tại ``/mcp`` — agent kết nối
``http://{host}:{port}/mcp`` (transport streamable-http, không trạng thái).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from mcp.server.fastmcp import FastMCP

from sandbox_kit_clone import __version__
from sandbox_kit_clone.config import Settings, get_settings
from sandbox_kit_clone.gateway import (
    download_router,
    install_error_handlers,
    upload_router,
)
from sandbox_kit_clone.gateway.admin_api import admin_api_router
from sandbox_kit_clone.gateway.mcp_server import register_tools
from sandbox_kit_clone.manager.manager import Manager
from sandbox_kit_clone.providers.fake import FakeProvider

# Tên MCP server hiển thị cho client (Inspector / Claude Code...).
MCP_SERVER_NAME = "sandbox-kit-clone"

# Trang admin UI (dev tool): file HTML tĩnh nằm cạnh module này.
ADMIN_HTML_PATH = Path(__file__).parent / "admin.html"
# Trang quản lý VFS (dev tool): duyệt/sửa file, lịch sử, dấu xóa, thử thuật toán.
VFS_HTML_PATH = Path(__file__).parent / "vfs.html"


def create_app(
    settings: Settings | None = None,
    provider: FakeProvider | None = None,
) -> FastAPI:
    """Dựng app hoàn chỉnh: REST (upload/download/health) + MCP mount tại ``/mcp``.

    ``settings``/``provider`` truyền vào cho test; mặc định đọc cấu hình env +
    FakeProvider lưu volume dưới ``data/fake-sandboxes``.
    """
    settings = settings or get_settings()
    provider = provider or FakeProvider(base_dir=Path(settings.data_dir) / "fake-sandboxes")
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
    def admin() -> HTMLResponse:
        """Bảng điều khiển test API (dev tool) — trang HTML tĩnh."""
        return HTMLResponse(ADMIN_HTML_PATH.read_text(encoding="utf-8"))

    @app.get("/admin/vfs", include_in_schema=False)
    def admin_vfs() -> HTMLResponse:
        """Trang quản lý VFS (dev tool) — dùng REST ``/admin/api/*``."""
        return HTMLResponse(VFS_HTML_PATH.read_text(encoding="utf-8"))

    app.include_router(upload_router)
    app.include_router(download_router)
    app.include_router(admin_api_router)
    install_error_handlers(app)
    app.mount("/mcp", mcp.streamable_http_app())
    return app
