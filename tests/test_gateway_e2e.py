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
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.gateway.app import create_app
from sandbox_kit_clone.manager.exec_client import PulledFile
from sandbox_kit_clone.manager.manager import Manager
from sandbox_kit_clone.providers.fake import FakeProvider
from sandbox_kit_clone.sync import workspace_sync
from sandbox_kit_clone.vfs.core import VFS
from sandbox_kit_clone.vfs.schema import DEFAULT_CONFLICT_POLICY


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


def test_tool_file_lifecycle_with_fuzzy_and_ignore(tmp_path: Path) -> None:
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

    # thư viện phụ thuộc không được lưu (không có ngoại lệ force)
    blocked = tools["file_write"](session_id=session_id, path="node_modules/x.js", content="x")
    assert blocked["error"]["code"] == "ignored_path"
    listed = tools["file_list"](session_id=session_id)["files"]
    assert [f["path"] for f in listed] == ["src/app.py"]

    # file không tồn tại → payload lỗi chuẩn
    missing = tools["file_read"](session_id=session_id, path="nope.txt")
    assert missing["error"]["code"] == "file_not_found"
    err_session = tools["file_write"](session_id="khong-ton-tai", path="a.txt", content="a")
    assert err_session["error"]["code"] == "session_not_found"

    # file_delete → file_list rỗng; sync_status có revision
    deleted = tools["file_delete"](session_id=session_id, path="src/app.py")
    assert deleted["origin"] == "vfs"
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


# --------------------------------------------- nghiệp vụ create_workspace (chốt 5 điểm)


def test_workspace_create_output_full(tmp_path: Path) -> None:
    """Đầu ra đầy đủ: conflict_policy + created_at; policy ghi đúng vào workspace_meta."""
    import sqlite3

    app = _app(tmp_path)
    tools = app.state.tool_fns
    ws = tools["workspace_create"](name="nghiệp-vụ")
    assert ws["conflict_policy"] == "sandbox_wins"
    assert ws["created_at"] and "T" in ws["created_at"]  # ISO UTC
    db = tmp_path / "data" / "workspaces" / f"{ws['workspace_id']}.sqlite"
    row = sqlite3.connect(db).execute(
        "SELECT conflict_policy FROM workspace_meta WHERE id = 1"
    ).fetchone()
    assert row[0] == "sandbox_wins"


def test_workspace_create_policy_error_ok(tmp_path: Path) -> None:
    app = _app(tmp_path)
    ws = app.state.tool_fns["workspace_create"](name="", conflict_policy="error")
    assert ws["conflict_policy"] == "error"


def test_workspace_create_policy_invalid(tmp_path: Path) -> None:
    app = _app(tmp_path)
    ws = app.state.tool_fns["workspace_create"](conflict_policy="hero_wins")
    assert ws["error"]["code"] == "invalid_request"


# ------------------------------------------------- 4. Tầng Manager pull-back (W3)

# Lưu ý: workspace_sync.pull và VFS.conflict_policy do agent song song viết — test dưới
# tách bạch: stop dùng stub workspace_sync.pull (độc lập), sync_pull dùng pull THẬT với
# stub ExecClient (nếu pull chưa merge, test này fail — chạy lại sau khi merge).


def _patch_conflict_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    """``VFS.conflict_policy`` chưa merge thì vá tạm (policy mặc định); đã có → dùng thật."""
    if hasattr(VFS, "conflict_policy"):
        return
    monkeypatch.setattr(
        VFS, "conflict_policy", property(lambda self: DEFAULT_CONFLICT_POLICY), raising=False
    )


class _StubPullClient:
    """ExecClient giả lập: ``list_files``/``pull`` trả nội dung có sẵn — không cần agent thật."""

    def __init__(self, files: dict[str, bytes], calls: list[str] | None = None) -> None:
        self._files = files
        self.calls = calls if calls is not None else []

    def wait_ready(self, timeout: float = 90.0) -> None:
        self.calls.append(f"wait_ready:{timeout:.0f}")

    def list_files(self, exclude_dirs: list[str], with_sha256: bool = True, limit: int = 0) -> list[dict]:
        self.calls.append("list_files")
        return [
            {"path": p, "size": len(d), "sha256": hashlib.sha256(d).hexdigest(), "mtime_ns": 0}
            for p, d in sorted(self._files.items())
        ]

    def pull(self, paths: list[str], timeout: float = 600.0):
        self.calls.append("pull:" + ",".join(paths))
        for p in paths:
            data = self._files.get(p)
            if data is None:
                yield PulledFile(path=p, size=0, sha256="", error="missing")
                continue
            yield PulledFile(path=p, size=len(data), sha256=hashlib.sha256(data).hexdigest(), _chunks=[data])


@pytest.fixture()
def mgr(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Manager tầng dưới với fake provider có exec agent (ExecClient sẽ bị stub từng test)."""
    _patch_conflict_policy(monkeypatch)
    settings = Settings(data_dir=str(tmp_path / "data"))
    provider = FakeProvider(base_dir=tmp_path / "fake", exec_host=True)
    manager = Manager(settings, provider)
    yield manager
    for sbx in list(provider.list_sandboxes()):
        provider.terminate_sandbox(sbx)


def _started(mgr: Manager) -> str:
    """Workspace + 1 file trong kho + sandbox RUNNING (seed volume từ kho)."""
    sid = mgr.create_workspace("pull-e2e")["session_id"]
    _ws, vfs = mgr.resolve_session(sid)
    try:
        vfs.write_file("src/app.py", "def main():\n    print('hi')\n")
    finally:
        vfs.close()
    mgr.sandbox_start(sid)
    return sid


def _stub_client(mgr: Manager, monkeypatch: pytest.MonkeyPatch, client: _StubPullClient) -> None:
    """Hồ ExecClientPool trả stub — manager gọi stub thay vì agent gRPC thật."""
    monkeypatch.setattr(mgr.exec_clients, "get", lambda sandbox_id, target: client)


def test_sync_pull_imports_agent_file(mgr: Manager, monkeypatch: pytest.MonkeyPatch) -> None:
    """sync_pull: file agent tạo trong sandbox được nhận về kho VFS (pull thật + stub client)."""
    sid = _started(mgr)
    content = b"print('tu sandbox')\n"
    client = _StubPullClient({"agent_made.py": content})
    _stub_client(mgr, monkeypatch, client)

    summary = mgr.sync_pull(sid)

    assert summary["pulled"] is True
    assert {"path": "agent_made.py", "kind": "import"} in summary["applied"]
    assert summary["policy"] == DEFAULT_CONFLICT_POLICY
    _ws, vfs = mgr.resolve_session(sid)
    try:
        assert vfs.read_file("agent_made.py") == content
        info = vfs.get_file_info("agent_made.py")
        assert info is not None and info["sha256"] == hashlib.sha256(content).hexdigest()
    finally:
        vfs.close()


def test_sandbox_stop_blocks_on_pull_failure(mgr: Manager, monkeypatch: pytest.MonkeyPatch) -> None:
    """Pull bị chặn khi stop: không force → conflict + sandbox CÒN; force → hủy và ghi forced."""

    def _blocked(**_kwargs):
        raise AppError(
            ErrorCode.conflict,
            "Xung đột theo policy error",
            details={"conflicts": [{"path": "src/app.py", "reason": "đã sửa cả hai phía"}]},
        )

    sid = _started(mgr)
    sandbox_id = mgr.store.get_session(sid)["sandbox_id"]
    _stub_client(mgr, monkeypatch, _StubPullClient({}))
    monkeypatch.setattr(workspace_sync, "pull", _blocked, raising=False)

    # Không force → từ chối hủy: AppError(conflict) kèm thông tin pull, sandbox còn nguyên.
    with pytest.raises(AppError) as exc:
        mgr.sandbox_stop(sid)
    assert exc.value.code is ErrorCode.conflict
    assert exc.value.details["pull"]["conflicts"][0]["path"] == "src/app.py"
    assert mgr.provider.get_sandbox_state(sandbox_id) == "running"
    assert mgr.store.get_session(sid)["state"] == "RUNNING"

    # force=True → hủy luôn, kết quả ghi rõ đã ép bỏ thay đổi.
    stopped = mgr.sandbox_stop(sid, force=True)
    assert stopped["state"] == "STANDBY"
    assert stopped["pulled"]["forced"] is True
    assert stopped["pulled"]["code"] == "conflict"
    assert sandbox_id not in mgr.provider.list_sandboxes()


def test_sandbox_stop_pulls_before_terminate(mgr: Manager, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stop thành công có pull: pull chạy TRƯỚC terminate; kết quả kèm tóm tắt pull."""
    sid = _started(mgr)
    sandbox_id = mgr.store.get_session(sid)["sandbox_id"]
    order: list[str] = []
    _stub_client(mgr, monkeypatch, _StubPullClient({"made.txt": b"x"}))

    def _ok(**_kwargs):
        order.append("pull")
        return {
            "pulled": True,
            "applied": [{"path": "made.txt", "kind": "import"}],
            "conflicts": [],
            "failures": [],
            "bytes": 1,
            "duration_ms": 3,
        }

    monkeypatch.setattr(workspace_sync, "pull", _ok, raising=False)
    real_terminate = mgr.provider.terminate_sandbox

    def _terminate(sbx: str) -> None:
        order.append("terminate")
        real_terminate(sbx)

    monkeypatch.setattr(mgr.provider, "terminate_sandbox", _terminate)

    stopped = mgr.sandbox_stop(sid)
    assert order == ["pull", "terminate"]  # pull xong hẳn mới hủy sandbox
    assert stopped["state"] == "STANDBY"
    assert stopped["pulled"]["pulled"] is True
    assert stopped["pulled"]["applied"] == [{"path": "made.txt", "kind": "import"}]
    assert sandbox_id not in mgr.provider.list_sandboxes()


def test_sandbox_compare_in_sync_counts_only_sandbox(mgr: Manager, monkeypatch: pytest.MonkeyPatch) -> None:
    """only_sandbox khác rỗng (file kho không có) → in_sync False dù mọi file kho khớp."""
    sid = _started(mgr)
    seed = {"src/app.py": b"def main():\n    print('hi')\n"}
    _stub_client(mgr, monkeypatch, _StubPullClient({**seed, "made-by-agent.txt": b"x"}))

    cmp = mgr.sandbox_compare(sid)
    assert cmp["in_sync"] is False
    assert [p["path"] for p in cmp["only_sandbox"]] == ["made-by-agent.txt"]
    assert cmp["differ"] == [] and cmp["only_vfs"] == []

    # Hết file lạ → đồng bộ thật sự (đối chiếu ngược để chắc không âm tính giả).
    _stub_client(mgr, monkeypatch, _StubPullClient(dict(seed)))
    assert mgr.sandbox_compare(sid)["in_sync"] is True
