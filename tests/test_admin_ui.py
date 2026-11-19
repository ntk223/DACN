"""Kiểm thử bảng điều khiển /admin (W1.5): route HTML tĩnh, không phá tính năng cũ."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sandbox_kit_clone import __version__
from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway.app import create_app
from sandbox_kit_clone.providers.fake import FakeProvider

# Đủ 14 tool MCP phải xuất hiện trong trang admin (metadata JS sinh form).
TOOL_NAMES = [
    "workspace_create",
    "sandbox_start",
    "sandbox_stop",
    "sandbox_pause",
    "sandbox_resume",
    "sandbox_renew",
    "sandbox_status",
    "file_write",
    "file_read",
    "file_edit",
    "file_delete",
    "file_list",
    "command_run",
    "sync_status",
]


def _app(tmp_path: Path):
    settings = Settings(data_dir=str(tmp_path / "data"))
    provider = FakeProvider(base_dir=tmp_path / "fake-sandboxes")
    return create_app(settings=settings, provider=provider)


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """App thật + TestClient (tái dùng pattern của test_gateway_e2e)."""
    return TestClient(_app(tmp_path))


def test_admin_serves_html_with_all_14_tools(client: TestClient) -> None:
    res = client.get("/admin")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    body = res.text
    assert "Sandbox Kit Clone" in body
    for name in TOOL_NAMES:
        assert name in body, f"Trang admin thiếu tool '{name}'"


def test_admin_route_does_not_break_health(client: TestClient) -> None:
    """/admin thêm vào không ảnh hưởng route khác; route dev không lộ trong OpenAPI."""
    assert client.get("/admin").status_code == 200
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "version": __version__}
    openapi = client.get("/openapi.json").json()
    assert "/admin" not in openapi["paths"]  # include_in_schema=False
