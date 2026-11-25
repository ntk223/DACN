"""Quản lý sandbox (W2): nạp file VFS vào sandbox, REST /admin/api/sandboxes*, chọn provider."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway.app import create_app
from sandbox_kit_clone.providers.factory import get_provider
from sandbox_kit_clone.providers.fake import FakeProvider


@pytest.fixture()
def app(tmp_path: Path):
    settings = Settings(data_dir=str(tmp_path / "data"))
    return create_app(settings=settings, provider=FakeProvider(base_dir=tmp_path / "fake"))


@pytest.fixture()
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture()
def session(client: TestClient) -> dict:
    ws = client.post("/admin/api/workspaces", json={"name": "sb"}).json()
    put = f"/admin/api/workspaces/{ws['workspace_id']}/file"
    assert client.put(put, json={"path": "src/app.py", "content": "print('hi')\n"}).status_code == 200
    assert client.put(put, json={"path": "README.md", "content": "# sb\n"}).status_code == 200
    return ws


def _start(client: TestClient, session_id: str, **body) -> dict:
    res = client.post(f"/admin/api/sessions/{session_id}/start", json={"ttl_seconds": 600, **body})
    assert res.status_code == 200, res.text
    return res.json()


def test_page_served(client: TestClient) -> None:
    # Trang sandbox cũ đã gộp vào /admin (SPA) — route cũ chuyển hướng.
    res = client.get("/admin/sandboxes", follow_redirects=False)
    assert res.status_code == 302 and res.headers["location"] == "/admin"


def test_start_materializes_vfs_files(app, client: TestClient, session: dict) -> None:
    started = _start(client, session["session_id"])
    assert started["materialized_files"] == 2 and started["synced_revision"] == 2
    sandbox_id = started["sandbox_id"]

    detail = client.get(f"/admin/api/sandboxes/{sandbox_id}").json()
    assert [f["path"] for f in detail["workspace"]["files"]] == ["README.md", "src/app.py"]
    f = client.get(f"/admin/api/sandboxes/{sandbox_id}/file", params={"path": "src/app.py"}).json()
    assert f["content"] == "print('hi')\n" and f["encoding"] == "utf-8"

    manager = app.state.manager
    sync = manager.store.get_sync_state(sandbox_id)
    assert sync["status"] == "synced" and sync["last_synced_revision"] == 2
    _ws, vfs = manager.resolve_session(session["session_id"])
    info = vfs.get_file_info("src/app.py")
    vfs.close()
    assert info["synced_sha256"] == info["sha256"]
    # Thư mục tạm dùng để nạp đã được dọn.
    assert not any((Path(manager.settings.data_dir) / "materialize").glob("*"))


def test_lifecycle_actions_and_overview(client: TestClient, session: dict) -> None:
    sid = session["session_id"]
    sandbox_id = _start(client, sid)["sandbox_id"]
    over = client.get("/admin/api/sandboxes").json()
    row = next(s for s in over["sessions"] if s["session_id"] == sid)
    assert over["provider"] == "fake" and row["state"] == "RUNNING"
    assert row["provider_state"] == "running" and row["drift"] is False and row["workspace_name"] is None

    assert client.post(f"/admin/api/sessions/{sid}/pause").json()["state"] == "PAUSED"
    assert client.post(f"/admin/api/sessions/{sid}/pause").status_code == 400  # sai trạng thái
    assert client.post(f"/admin/api/sessions/{sid}/resume").json()["state"] == "RUNNING"
    assert client.post(f"/admin/api/sessions/{sid}/renew", json={"ttl_seconds": 60}).json()["expires_at"]
    assert client.post(f"/admin/api/sessions/{sid}/explode").status_code == 404
    assert client.post(f"/admin/api/sessions/{sid}/stop").json()["state"] == "STANDBY"
    assert client.get(f"/admin/api/sandboxes/{sandbox_id}").status_code == 404
    # Bật lại được sau khi dừng — file vẫn còn trong kho.
    assert _start(client, sid)["materialized_files"] == 2


def test_drift_and_orphan_cleanup(app, client: TestClient, session: dict) -> None:
    provider: FakeProvider = app.state.provider
    sid = session["session_id"]
    sandbox_id = _start(client, sid)["sandbox_id"]

    # Không xóa được sandbox đang thuộc phiên → phải dùng stop.
    assert client.delete(f"/admin/api/sandboxes/{sandbox_id}").status_code == 409

    # Sandbox bị dừng ngoài hệ thống → sổ ghi RUNNING nhưng thực tế paused → lệch.
    provider.pause_sandbox(sandbox_id)
    row = next(s for s in client.get("/admin/api/sandboxes").json()["sessions"] if s["session_id"] == sid)
    assert row["drift"] is True

    orphan = provider.create_sandbox("ghost-session", "img", 60)
    over = client.get("/admin/api/sandboxes").json()
    assert [o["sandbox_id"] for o in over["orphans"]] == [orphan]
    assert client.delete(f"/admin/api/sandboxes/{orphan}").status_code == 200
    assert client.get("/admin/api/sandboxes").json()["orphans"] == []


def test_start_with_unknown_session(client: TestClient) -> None:
    res = client.post("/admin/api/sessions/nope/start", json={})
    assert res.status_code == 400 and res.json()["error"]["code"] == "session_not_found"


def test_provider_setting_validation(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        Settings(provider="k8s")
    assert get_provider(Settings(data_dir=str(tmp_path))).name == "fake"
