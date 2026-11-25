"""Kiểm thử giao diện quản trị /admin (SPA React, build trong ``web/dist``).

Route cũ của 3 trang riêng (/admin/vfs, /admin/sandboxes) chuyển hướng về /admin.
Chức năng thật của UI được kiểm qua REST ``/admin/api/*`` (test_admin_vfs,
test_sandbox_admin) — test này chỉ kiểm việc phục vụ trang và tính ẩn khỏi OpenAPI.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sandbox_kit_clone import __version__
from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway.app import WEB_DIST_DIR, create_app
from sandbox_kit_clone.providers.fake import FakeProvider


def _app(tmp_path: Path):
    settings = Settings(data_dir=str(tmp_path / "data"))
    provider = FakeProvider(base_dir=tmp_path / "fake-sandboxes")
    return create_app(settings=settings, provider=provider)


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """App thật + TestClient (tái dùng pattern của test_gateway_e2e)."""
    return TestClient(_app(tmp_path))


def _dist_built() -> bool:
    return (WEB_DIST_DIR / "index.html").is_file()


@pytest.mark.skipif(not _dist_built(), reason="chưa build web (make web)")
def test_admin_serves_spa(client: TestClient) -> None:
    """/admin trả index.html của SPA; asset nằm cạnh trong /admin/assets."""
    res = client.get("/admin")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "Sandbox Kit" in res.text  # <title> của index.html


def test_admin_without_dist_returns_hint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Chưa build web → /admin vẫn 200 với trang nhắc ``make web``."""
    monkeypatch.setattr(
        "sandbox_kit_clone.gateway.app.WEB_DIST_DIR", tmp_path / "khong-ton-tai"
    )
    client = TestClient(_app(tmp_path))
    res = client.get("/admin")
    assert res.status_code == 200
    assert "make web" in res.text


def test_admin_redirects_to_trailing_slash(client: TestClient) -> None:
    """/admin → 307 /admin/ để đường dẫn asset tương đối resolve đúng."""
    res = client.get("/admin", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/admin/"


def test_legacy_admin_routes_redirect(client: TestClient) -> None:
    """Route cũ của 3 trang riêng → 302 về /admin, không lộ trong OpenAPI."""
    for path in ("/admin/vfs", "/admin/sandboxes"):
        res = client.get(path, follow_redirects=False)
        assert res.status_code == 302
        assert res.headers["location"] == "/admin/"
    openapi = client.get("/openapi.json").json()
    assert not any(p.startswith("/admin") for p in openapi["paths"])


def test_admin_route_does_not_break_health(client: TestClient) -> None:
    """/admin thêm vào không ảnh hưởng route khác; route dev không lộ trong OpenAPI."""
    assert client.get("/admin").status_code == 200
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "version": __version__}
