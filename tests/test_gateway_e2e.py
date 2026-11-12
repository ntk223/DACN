"""Kiểm thử W1.5 E2E: app FastAPI hoàn chỉnh — REST upload/download + tool MCP + transport thật.

Ba tầng:
1. REST qua app thật (TestClient): /health + upload theo phần → download roundtrip.
2. Tool MCP gọi trực tiếp qua ``app.state.tool_fns`` (không cần transport).
3. Transport MCP thật: uvicorn nền + client SDK ``mcp`` qua streamable-http.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import socket
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from sandbox_kit_clone import __version__
from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway.app import create_app
from sandbox_kit_clone.providers.fake import FakeProvider


def _settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=str(tmp_path / "data"))


def _app(tmp_path: Path):
    settings = _settings(tmp_path)
    provider = FakeProvider(base_dir=tmp_path / "fake-sandboxes")
    return create_app(settings=settings, provider=provider)


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """App thật + TestClient (REST không cần lifespan FastMCP)."""
    return TestClient(_app(tmp_path))


# ------------------------------------------------------------- 1. REST level


def test_health(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "version": __version__}


def test_upload_chunked_then_download_roundtrip(client: TestClient) -> None:
    """E2E file lớn: init → 2 chunk (tổng 5MB) → complete → vfs → download khớp sha."""
    created = client.app.state.tool_fns["workspace_create"](name="upload-e2e")  # type: ignore[attr-defined]
    workspace_id = created["workspace_id"]

    content = b"VyDT-2026-large-file-" * 245_760  # ~4.9MB → 2 chunk, < ngưỡng blob 32MB
    sha = hashlib.sha256(content).hexdigest()

    init = client.post("/upload", json={"workspace_id": workspace_id, "path": "big/assets.bin", "size": len(content), "sha256": sha})
    assert init.status_code == 200, init.text
    token = init.json()["token"]
    assert init.json()["chunk_size"] > 0

    mid = len(content) // 2
    put1 = client.put(f"/upload/{token}", params={"chunk": 0}, content=content[:mid])
    assert put1.status_code == 200, put1.text
    put2 = client.put(f"/upload/{token}", params={"chunk": 1}, content=content[mid:])
    assert put2.status_code == 200, put2.text

    status = client.get(f"/upload/{token}/status")
    assert status.status_code == 200
    assert status.json()["chunks_received"] == 2

    done = client.post(f"/upload/{token}/complete")
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["storage"] == "vfs"  # 5MB < ngưỡng blob sidecar 32MB
    assert body["sha256"] == sha

    res = client.get(f"/download/{workspace_id}", params={"path": "big/assets.bin"})
    assert res.status_code == 200, res.text
    assert res.headers["X-File-Sha256"] == sha
    assert res.content == content  # roundtrip khớp từng byte


def test_download_missing_file_is_404(client: TestClient) -> None:
    created = client.app.state.tool_fns["workspace_create"]()  # type: ignore[attr-defined]
    res = client.get(f"/download/{created['workspace_id']}", params={"path": "khong-co.txt"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "file_not_found"


# ---------------------------------------------------- 2. Tool MCP gọi trực tiếp


def test_tool_file_lifecycle_with_fuzzy_and_force(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tools = app.state.tool_fns
    created = tools["workspace_create"](name="tool-level")
    session_id = created["session_id"]

    # file_write → file_read roundtrip
    written = tools["file_write"](
        session_id=session_id, path="src/app.py", content="def main():\n    print('hi')\n"
    )
    assert written["rev"] >= 1 and written["storage_class"] == "vfs"
    read = tools["file_read"](session_id=session_id, path="src/app.py")
    assert read["content"] == "def main():\n    print('hi')\n"
    assert read["is_binary"] == 0 and read["size"] == len("def main():\n    print('hi')\n")

    # file_edit fuzzy: old_text lệch indent so với file → used_fuzzy True
    edited = tools["file_edit"](
        session_id=session_id, path="src/app.py", old_text="def main():\n  print('hi')", new_text="def main():\n      print('ok')"
    )
    assert edited["used_fuzzy"] is True

    # force node_modules: không force → lỗi ignored_path; có force → cảnh báo 'đóng băng'
    blocked = tools["file_write"](session_id=session_id, path="node_modules/x.js", content="x")
    assert blocked["error"]["code"] == "ignored_path"
    forced = tools["file_write"](
        session_id=session_id, path="node_modules/x.js", content="x", force=True
    )
    assert any("đóng băng" in w for w in forced["warnings"])

    # file không tồn tại → payload lỗi chuẩn
    missing = tools["file_read"](session_id=session_id, path="nope.txt")
    assert missing["error"]["code"] == "file_not_found"
    err_session = tools["file_write"](session_id="khong-ton-tai", path="a.txt", content="a")
    assert err_session["error"]["code"] == "session_not_found"

    # file_delete → file_list rỗng; sync_status có revision
    deleted = tools["file_delete"](session_id=session_id, path="node_modules/x.js")
    assert deleted["origin"] == "vfs"
    tools["file_delete"](session_id=session_id, path="src/app.py")
    listing = tools["file_list"](session_id=session_id)
    assert listing["files"] == []
    synced = tools["sync_status"](session_id=session_id)
    assert synced["workspace_revision"] >= 1 and synced["pending_push"] == 0


def test_tool_sandbox_lifecycle(tmp_path: Path) -> None:
    app = _app(tmp_path)
    tools = app.state.tool_fns
    provider = app.state.provider
    session_id = tools["workspace_create"]()["session_id"]

    started = tools["sandbox_start"](session_id=session_id, ttl_seconds=1800)
    assert started["state"] == "RUNNING" and started["sandbox_id"] and started["dial_target"]
    assert provider.get_sandbox_state(started["sandbox_id"]) == "running"

    status = tools["sandbox_status"](session_id=session_id)
    assert status["provider_state"] == "running" and status["expires_at"] is not None

    # start lần nữa → sai state
    again = tools["sandbox_start"](session_id=session_id)
    assert again["error"]["code"] == "invalid_request"

    paused = tools["sandbox_pause"](session_id=session_id)
    assert paused["state"] == "PAUSED"
    resumed = tools["sandbox_resume"](session_id=session_id)
    assert resumed["state"] == "RUNNING"
    renewed = tools["sandbox_renew"](session_id=session_id, ttl_seconds=600)
    assert renewed["state"] == "RUNNING" and renewed["expires_at"] > status["expires_at"]

    stopped = tools["sandbox_stop"](session_id=session_id)
    assert stopped["state"] == "STANDBY"
    # Sandbox đã bị terminate + dọn volume → provider_state về None.
    final = tools["sandbox_status"](session_id=session_id)
    assert final["state"] == "STANDBY" and final["provider_state"] is None

    sync = tools["sync_status"](session_id=session_id)
    assert sync["workspace_revision"] == 0  # chưa ghi file nào


# ------------------------------------------------- 3. Transport MCP thật (uvicorn)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _mcp_transport_flow(tmp_path: Path) -> None:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    app = _app(tmp_path)
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    try:
        async with streamablehttp_client(f"http://127.0.0.1:{port}/mcp") as (read, write, _), ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            assert len(tools.tools) >= 8
            names = {t.name for t in tools.tools}
            assert {"workspace_create", "file_write", "file_read", "sync_status"} <= names

            def payload(result):
                if result.structuredContent is not None:
                    return result.structuredContent
                return json.loads(result.content[0].text)

            created = payload(await session.call_tool("workspace_create", {"name": "transport"}))
            session_id = created["session_id"]
            assert session_id

            written = payload(await session.call_tool("file_write", {
                "session_id": session_id, "path": "docs/ghi.md", "content": "# qua MCP thật\n",
            }))
            assert written["rev"] >= 1

            read = payload(await session.call_tool("file_read", {
                "session_id": session_id, "path": "docs/ghi.md",
            }))
            assert read["content"] == "# qua MCP thật\n"

            blocked = payload(await session.call_tool("file_write", {
                "session_id": session_id, "path": ".venv/lib.py", "content": "x",
            }))
            assert blocked["error"]["code"] == "ignored_path"
    finally:
        server.should_exit = True
        await task


def test_mcp_transport_over_real_http(tmp_path: Path) -> None:
    """Chứng minh protocol thật: server uvicorn nền + client SDK MCP qua streamable-http."""
    asyncio.run(_mcp_transport_flow(tmp_path))
