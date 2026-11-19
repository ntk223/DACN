"""Kiểm thử trang quản lý VFS (/admin/vfs), REST /admin/api/* và script init_db."""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway.app import create_app
from sandbox_kit_clone.providers.fake import FakeProvider

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    settings = Settings(data_dir=str(tmp_path / "data"))
    app = create_app(settings=settings, provider=FakeProvider(base_dir=tmp_path / "fake"))
    return TestClient(app)


@pytest.fixture()
def ws(client: TestClient) -> str:
    res = client.post("/admin/api/workspaces", json={"name": "t", "conflict_policy": "error"})
    assert res.status_code == 200
    return res.json()["workspace_id"]


def _put(client: TestClient, ws: str, path: str, content: str, **kw) -> dict:
    res = client.put(f"/admin/api/workspaces/{ws}/file", json={"path": path, "content": content, **kw})
    assert res.status_code == 200, res.text
    return res.json()


def test_page_served_and_hidden_from_openapi(client: TestClient) -> None:
    res = client.get("/admin/vfs")
    assert res.status_code == 200 and "Quản lý VFS" in res.text
    paths = client.get("/openapi.json").json()["paths"]
    assert not any(p.startswith("/admin") for p in paths)


def test_overview_and_detail(client: TestClient, ws: str) -> None:
    _put(client, ws, "src/a.py", "x = 1\n")
    over = client.get("/admin/api/overview").json()
    item = next(w for w in over["workspaces"] if w["id"] == ws)
    assert item["file_count"] == 1 and item["conflict_policy"] == "error" and item["session_id"]
    assert over["settings"]["max_revisions_per_file"] == 20
    detail = client.get(f"/admin/api/workspaces/{ws}").json()
    assert [f["path"] for f in detail["files"]] == ["src/a.py"]
    assert detail["operations"][0]["type"] == "workspace_create"


def test_unknown_workspace_404(client: TestClient) -> None:
    assert client.get("/admin/api/workspaces/nope").status_code == 404


def test_write_read_history_restore(client: TestClient, ws: str) -> None:
    _put(client, ws, "a.txt", "v1\n")
    _put(client, ws, "a.txt", "v2\n")
    assert _put(client, ws, "a.txt", "v2\n")["noop"] is True
    f = client.get(f"/admin/api/workspaces/{ws}/file", params={"path": "a.txt"}).json()
    assert f["content"] == "v2\n" and f["encoding"] == "utf-8"
    assert len(f["revisions"]) == 1 and f["revisions"][0]["restorable"]
    _put(client, ws, "a.txt", "v3\n")
    revs = client.get(f"/admin/api/workspaces/{ws}/file", params={"path": "a.txt"}).json()["revisions"]
    oldest = revs[-1]  # patch = "v2\n"
    res = client.post(f"/admin/api/workspaces/{ws}/restore", json={"path": "a.txt", "revision_id": oldest["id"]})
    assert res.status_code == 200
    f = client.get(f"/admin/api/workspaces/{ws}/file", params={"path": "a.txt"}).json()
    assert f["content"] == "v2\n"


def test_binary_write_base64(client: TestClient, ws: str) -> None:
    raw = b"\x89PNG\x00\x01"
    _put(client, ws, "i.png", base64.b64encode(raw).decode(), encoding="base64")
    f = client.get(f"/admin/api/workspaces/{ws}/file", params={"path": "i.png"}).json()
    assert f["encoding"] == "base64" and base64.b64decode(f["content"]) == raw


def test_edit_dry_run_does_not_write(client: TestClient, ws: str) -> None:
    _put(client, ws, "c.py", "def f():\n    return 1\n")
    body = {"path": "c.py", "old_text": "return   1", "new_text": "return 2", "dry_run": True}
    r = client.post(f"/admin/api/workspaces/{ws}/edit", json=body).json()
    assert r["dry_run"] and r["used_fuzzy"] and "    return 2" in r["after"]
    f = client.get(f"/admin/api/workspaces/{ws}/file", params={"path": "c.py"}).json()
    assert "return 1" in f["content"]
    r = client.post(f"/admin/api/workspaces/{ws}/edit", json={**body, "dry_run": False}).json()
    assert r["used_fuzzy"] is True and r["rev"] > f["rev"]


def test_move_leaves_tombstone_and_delete(client: TestClient, ws: str) -> None:
    _put(client, ws, "old.txt", "x")
    r = client.post(f"/admin/api/workspaces/{ws}/move", json={"src": "old.txt", "dst": "new/n.txt"})
    assert r.status_code == 200
    detail = client.get(f"/admin/api/workspaces/{ws}").json()
    assert [f["path"] for f in detail["files"]] == ["new/n.txt"]
    assert [t["path"] for t in detail["tombstones"]] == ["old.txt"]
    assert client.delete(f"/admin/api/workspaces/{ws}/file", params={"path": "new/n.txt"}).status_code == 200


def test_write_guards_go_through_core(client: TestClient, ws: str) -> None:
    url = f"/admin/api/workspaces/{ws}/file"
    assert client.put(url, json={"path": "node_modules/a.js", "content": "x"}).status_code == 400
    assert client.put(url, json={"path": "../x", "content": "x"}).status_code == 400
    assert client.put(url, json={"path": ".venv/a.py", "content": "x"}).status_code == 400
    assert client.get(f"/admin/api/workspaces/{ws}").json()["files"] == []


def test_algo_path_and_fuzzy(client: TestClient) -> None:
    r = client.post("/admin/api/algo/path", json={"path": "/src/./x/../a.py"}).json()
    assert r["ok"] and r["canonical"] == "src/a.py" and r["changed"]
    r = client.post("/admin/api/algo/path", json={"path": "node_modules/a"}).json()
    assert not r["ok"] and r["error"]["code"] == "ignored_path" and "node_modules" in r["ignore_reason"]
    r = client.post("/admin/api/algo/path", json={"path": "tmp/a"}).json()
    assert r["ok"]
    r = client.post("/admin/api/algo/path", json={"path": "../a"}).json()
    assert not r["ok"] and r["error"]["code"] == "invalid_path"
    r = client.post("/admin/api/algo/fuzzy", json={"content": "a\n  b c\n", "old_text": "b   c", "new_text": "d"}).json()
    assert r["ok"] and r["level"] == 2 and r["result"] == "a\n  d\n"
    r = client.post("/admin/api/algo/fuzzy", json={"content": "x\nx\n", "old_text": "x", "new_text": "y"}).json()
    assert not r["ok"] and r["level"] == 3


def test_init_db_script_seeds_and_self_checks(tmp_path: Path) -> None:
    data = tmp_path / "seed"
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "init_db.py"), "--data-dir", str(data), "--seed"],
        check=False, capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "✗" not in proc.stdout
    manifest = json.loads((data / "seed-manifest.json").read_text(encoding="utf-8"))
    names = {w["name"] for w in manifest["workspaces"]}
    assert {"demo-basic", "demo-history", "demo-tombstone", "demo-ignore", "demo-quota"} <= names
    # Trang admin đọc được dữ liệu seed + nhãn.
    app = create_app(settings=Settings(data_dir=str(data)), provider=FakeProvider(base_dir=data / "fake"))
    over = TestClient(app).get("/admin/api/overview").json()
    assert {w["name"] for w in over["workspaces"]} >= names


def test_upload_init_rejects_dependency_path(client: TestClient, ws: str) -> None:
    """Chặn ngay ở bước khai báo — client không mất công truyền file thư viện."""
    res = client.post("/upload", json={"workspace_id": ws, "path": "node_modules/big.js", "size": 10})
    assert res.status_code == 400 and res.json()["error"]["code"] == "ignored_path"
