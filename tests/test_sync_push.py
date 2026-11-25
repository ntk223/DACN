"""Đẩy thay đổi VFS → sandbox trước mỗi lệnh (W2) + RPC SyncFiles / ListFiles của trình thực thi.

Chạy không cần Docker: FakeProvider(exec_host=True) dùng trình thực thi thật trên máy.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from sandbox_kit_clone.agent.server import build_server
from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError
from sandbox_kit_clone.manager.exec_client import DeleteOp, ExecClient, PutOp
from sandbox_kit_clone.manager.manager import Manager
from sandbox_kit_clone.providers.fake import FakeProvider

# ---------------------------------------------------------------- RPC agent


@pytest.fixture()
def agent(tmp_path: Path):
    root = tmp_path / "ws"
    root.mkdir()
    server, port = build_server(root, "127.0.0.1:0", max_workers=4)
    server.start()
    client = ExecClient(f"127.0.0.1:{port}")
    client.wait_ready(5)
    yield client, root
    client.close()
    server.stop(0)


def _put(path: str, data: bytes, sha: str | None = None) -> PutOp:
    return PutOp(path, sha or hashlib.sha256(data).hexdigest(), len(data), lambda: iter((data,)))


def test_sync_files_acks_each_op(agent) -> None:
    client, root = agent
    (root / "gone.txt").write_text("x")
    big = bytes(range(256)) * 10_000  # 2.5MB → nhiều đoạn 1MB
    reply = client.sync([
        _put("a/b/c.txt", b"hello"),
        _put("big.bin", big),
        _put("bad.txt", b"data", sha="0" * 64),  # sha sai → từ chối, không ghi
        _put("../escape.txt", b"x"),
        DeleteOp("gone.txt"),
        DeleteOp("never-existed.txt"),  # xóa thứ không có → vẫn ok (chạy lại an toàn)
    ])
    acks = {(a.path, a.op): a for a in reply.acks}
    assert len(reply.acks) == 6
    assert acks[("a/b/c.txt", 0)].ok and (root / "a/b/c.txt").read_bytes() == b"hello"
    assert acks[("big.bin", 0)].ok and (root / "big.bin").read_bytes() == big
    assert not acks[("bad.txt", 0)].ok and "sha256" in acks[("bad.txt", 0)].error
    assert not (root / "bad.txt").exists()
    assert not acks[("../escape.txt", 0)].ok and not (root.parent / "escape.txt").exists()
    assert acks[("gone.txt", 1)].ok and not (root / "gone.txt").exists()
    assert acks[("never-existed.txt", 1)].ok
    assert not list(root.rglob(".skc-sync-*"))  # không sót file tạm


def test_list_files_with_sha_and_excludes(agent) -> None:
    client, root = agent
    (root / "src").mkdir()
    (root / "src/app.py").write_text("print(1)\n")
    (root / "node_modules/x").mkdir(parents=True)
    (root / "node_modules/x/i.js").write_text("1")
    entries = client.list_files(["node_modules"], with_sha256=True)
    assert [e["path"] for e in entries] == ["src/app.py"]
    assert entries[0]["sha256"] == hashlib.sha256(b"print(1)\n").hexdigest()


# ------------------------------------------------------------- Manager.push


@pytest.fixture()
def mgr(tmp_path: Path):
    settings = Settings(data_dir=str(tmp_path / "data"), blob_sidecar_min_bytes=1024)
    provider = FakeProvider(base_dir=tmp_path / "fake", exec_host=True)
    manager = Manager(settings, provider)
    yield manager
    for sid in list(provider.list_sandboxes()):
        provider.terminate_sandbox(sid)


def _write(mgr: Manager, sid: str, **files: str | bytes | None) -> None:
    _ws, vfs = mgr.resolve_session(sid)
    try:
        for path, content in files.items():
            path = path.replace("__", "/")
            if content is None:
                vfs.delete_file(path)
            else:
                vfs.write_file(path, content)
    finally:
        vfs.close()


def _started(mgr: Manager) -> str:
    sid = mgr.create_workspace("sync")["session_id"]
    _write(mgr, sid, **{"a.txt": "v1\n", "old.txt": "x"})
    mgr.sandbox_start(sid)
    return sid


def test_gate_write_after_start_reaches_sandbox(mgr: Manager) -> None:
    """Gate W2 đầy đủ: ghi qua MCP SAU khi bật sandbox → lệnh kế tiếp đọc được."""
    sid = _started(mgr)
    _write(mgr, sid, **{"a.txt": "v2\n", "new__b.py": "print('mới')\n", "old.txt": None})
    status = mgr.sync_status(sid)
    assert (status["pending_put"], status["pending_delete"]) == (2, 1)

    r = mgr.command_run(sid, "cat a.txt && python3 new/b.py && ls")
    assert r["exit_code"] == 0 and r["stdout"] == "v2\nmới\na.txt\nnew\n"
    assert r["sync"]["put"] == 2 and r["sync"]["deleted"] == 1
    assert mgr.sync_status(sid)["pending_push"] == 0
    # Không có gì mới → bỏ qua bước đẩy.
    assert mgr.command_run(sid, "true")["sync"]["skipped"] is True
    cmp = mgr.sandbox_compare(sid)
    assert cmp["in_sync"] and cmp["same"] == 2


def test_blob_file_pushed_by_stream(mgr: Manager) -> None:
    sid = _started(mgr)
    data = bytes(range(256)) * 50  # 12.8KB ≥ ngưỡng 1KB của test → file rời
    _write(mgr, sid, **{"assets__big.bin": data})
    r = mgr.command_run(sid, "sha256sum assets/big.bin")
    assert r["stdout"].split()[0] == hashlib.sha256(data).hexdigest()


def test_failed_push_blocks_command_and_retries(mgr: Manager) -> None:
    """Sandbox không nhận được file → stale, mốc giữ nguyên, lệnh KHÔNG chạy; sửa xong thì tự đẩy lại."""
    sid = _started(mgr)
    sandbox_id = mgr.store.get_session(sid)["sandbox_id"]
    volume = Path(mgr.provider.describe_sandbox(sandbox_id)["volume"])
    (volume / "blocker").mkdir()  # thư mục chặn đường ghi file cùng tên
    _write(mgr, sid, **{"blocker": "là file trong kho\n", "ok.txt": "ok\n"})

    with pytest.raises(AppError) as exc:
        mgr.command_run(sid, "touch ran.txt")
    assert exc.value.code.value == "sync_unavailable"
    assert exc.value.details["failures"][0]["path"] == "blocker"
    assert not (volume / "ran.txt").exists()  # lệnh không chạy
    state = mgr.store.get_sync_state(sandbox_id)
    assert state["status"] == "stale" and state["last_synced_revision"] == 2
    assert (volume / "ok.txt").exists()  # file nhận được vẫn ghi thật

    (volume / "blocker").rmdir()
    r = mgr.command_run(sid, "cat blocker")
    assert r["stdout"] == "là file trong kho\n" and r["sync"]["put"] == 1  # chỉ phần còn thiếu
    assert mgr.store.get_sync_state(sandbox_id)["status"] == "synced"


def test_enforce_mode_blocks_and_logs(tmp_path: Path) -> None:
    settings = Settings(data_dir=str(tmp_path / "data"), policy_mode="enforce")
    provider = FakeProvider(base_dir=tmp_path / "fake", exec_host=True)
    mgr = Manager(settings, provider)
    try:
        sid = mgr.create_workspace()["session_id"]
        mgr.sandbox_start(sid)
        with pytest.raises(AppError) as exc:
            mgr.command_run(sid, "rm -rf / --no-preserve-root")
        assert exc.value.code.value == "command_blocked"
        ops = mgr.store._conn.execute("SELECT status FROM operations WHERE type='command_run'").fetchall()
        assert [o[0] for o in ops] == ["failed"]
        # Lớp 2 vẫn audit: chạy được, kèm cảnh báo.
        r = mgr.command_run(sid, "echo x > out.txt && cat out.txt")
        assert r["stdout"] == "x\n" and r["policy"]["warnings"]
    finally:
        for s in list(provider.list_sandboxes()):
            provider.terminate_sandbox(s)


def test_full_resync_and_compare_detects_drift(mgr: Manager) -> None:
    sid = _started(mgr)
    sandbox_id = mgr.store.get_session(sid)["sandbox_id"]
    volume = Path(mgr.provider.describe_sandbox(sandbox_id)["volume"])
    (volume / "a.txt").write_text("sửa tay trong sandbox\n")
    (volume / "made-by-build.txt").write_text("x")
    cmp = mgr.sandbox_compare(sid)
    assert not cmp["in_sync"] and [d["path"] for d in cmp["differ"]] == ["a.txt"]
    assert [p["path"] for p in cmp["only_sandbox"]] == ["made-by-build.txt"]
    assert mgr.sync_push(sid)["skipped"] is True  # delta không thấy gì (kho không đổi)
    assert mgr.sync_push(sid, full=True)["put"] == 2
    assert (volume / "a.txt").read_text() == "v1\n" and mgr.sandbox_compare(sid)["in_sync"]
