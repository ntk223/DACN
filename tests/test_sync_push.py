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
from sandbox_kit_clone.sync import workspace_sync

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


def _started(mgr: Manager, policy: str = "sandbox_wins") -> str:
    sid = mgr.create_workspace("sync", policy)["session_id"]
    _write(mgr, sid, **{"a.txt": "v1\n", "old.txt": "x"})
    mgr.sandbox_start(sid)
    return sid


# ------------------------------------------------------------ W3 pull-back / guard


def _sandbox_id(mgr: Manager, sid: str) -> str:
    return mgr.store.get_session(sid)["sandbox_id"]


def _volume(mgr: Manager, sid: str) -> Path:
    return Path(mgr.provider.describe_sandbox(_sandbox_id(mgr, sid))["volume"])


def _pull(mgr: Manager, sid: str) -> dict:
    """Gọi workspace_sync.pull trực tiếp với đúng client + policy của workspace."""
    session = mgr.store.get_session(sid)
    client = mgr.exec_clients.get(_sandbox_id(mgr, sid), mgr.provider.get_dial_target(_sandbox_id(mgr, sid)))
    _ws, vfs = mgr.resolve_session(sid)
    try:
        return workspace_sync.pull(
            store=mgr.store,
            vfs=vfs,
            client=client,
            sandbox_id=session["sandbox_id"],
            workspace_id=session["workspace_id"],
            policy=vfs.conflict_policy,
        )
    finally:
        vfs.close()


def _with_vfs(mgr: Manager, sid: str, fn):
    _ws, vfs = mgr.resolve_session(sid)
    try:
        return fn(vfs)
    finally:
        vfs.close()


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
    # in_sync (ngữ nghĩa mới) còn tính cả only_sandbox — made-by-build.txt vẫn chỉ có ở sandbox.
    cmp2 = mgr.sandbox_compare(sid)
    assert (volume / "a.txt").read_text() == "v1\n"
    assert cmp2["same"] == 2 and not cmp2["differ"] and not cmp2["only_vfs"]
    assert [p["path"] for p in cmp2["only_sandbox"]] == ["made-by-build.txt"]


# ------------------------------------------------------------ W3 pull-back (check-in)


def test_pull_imports_new_agent_file(mgr: Manager) -> None:
    """File agent tạo mới trong sandbox → nhận về kho (import), synced=sha, revision tăng."""
    sid = _started(mgr)
    data = "print('tạo bởi agent')\n".encode()
    (_volume(mgr, sid) / "agent_new.py").write_bytes(data)
    rev_before = _with_vfs(mgr, sid, lambda v: v.revision)

    r = _pull(mgr, sid)

    assert r["pulled"] is True
    assert {"path": "agent_new.py", "kind": "import"} in r["applied"]
    assert r["failures"] == [] and r["conflicts"] == []
    assert r["bytes"] == len(data)

    def check(v) -> int:
        info = v.get_file_info("agent_new.py")
        sha = hashlib.sha256(data).hexdigest()
        assert info["sha256"] == sha and info["synced_sha256"] == sha
        assert v.read_file("agent_new.py") == data
        return v.revision

    assert _with_vfs(mgr, sid, check) > rev_before  # ghi vào kho bump revision


def test_pull_takes_sandbox_only_edit(mgr: Manager) -> None:
    """Chỉ sandbox sửa → nội dung VFS = bản sandbox, synced cập nhật."""
    sid = _started(mgr)
    data = "bản sandbox sửa\n".encode()
    (_volume(mgr, sid) / "a.txt").write_bytes(data)

    r = _pull(mgr, sid)

    assert {"path": "a.txt", "kind": "update"} in r["applied"]
    assert r["conflicts"] == []

    def check(v) -> None:
        sha = hashlib.sha256(data).hexdigest()
        info = v.get_file_info("a.txt")
        assert info["sha256"] == sha and info["synced_sha256"] == sha
        assert v.read_file("a.txt") == data

    _with_vfs(mgr, sid, check)


def test_pull_error_policy_blocks_everything_on_modify_vs_modify(mgr: Manager) -> None:
    """Cả hai sửa + policy 'error' → AppError(conflict), VFS không đổi gì (kể cả phần không conflict)."""
    sid = _started(mgr, policy="error")
    volume = _volume(mgr, sid)
    _write(mgr, sid, **{"a.txt": "kho sửa\n"})  # VFS đi trước (synced vẫn bản cũ)
    (volume / "a.txt").write_text("sandbox sửa\n")  # sandbox cũng sửa → xung đột
    (volume / "by_agent.txt").write_text("agent\n")  # phần KHÔNG conflict

    with pytest.raises(AppError) as exc:
        _pull(mgr, sid)
    assert exc.value.code.value == "conflict"
    assert exc.value.details["conflicts"] == [
        {
            "path": "a.txt",
            "kind": "modify_vs_modify",
            "sandbox_sha256": hashlib.sha256("sandbox sửa\n".encode()).hexdigest(),
            "vfs_sha256": hashlib.sha256("kho sửa\n".encode()).hexdigest(),
        }
    ]

    def check(v) -> None:
        assert v.read_file("a.txt") == "kho sửa\n".encode()  # bản VFS giữ nguyên, không bị đè
        try:
            v.read_file("by_agent.txt")
            raise AssertionError("file mới của agent không được nhận về")
        except AppError as e:
            assert e.code.value == "file_not_found"

    _with_vfs(mgr, sid, check)


def test_pull_sandbox_wins_overwrites_vfs_on_modify_vs_modify(mgr: Manager) -> None:
    """Cả hai sửa + policy 'sandbox_wins' → VFS nhận đè bản sandbox, xung đột vẫn được báo."""
    sid = _started(mgr)  # mặc định sandbox_wins
    data = "bản sandbox thắng\n".encode()
    _write(mgr, sid, **{"a.txt": "kho sửa\n"})
    (_volume(mgr, sid) / "a.txt").write_bytes(data)

    r = _pull(mgr, sid)

    assert r["conflicts"][0]["kind"] == "modify_vs_modify"
    assert {"path": "a.txt", "kind": "update"} in r["applied"]
    assert _with_vfs(mgr, sid, lambda v: v.read_file("a.txt")) == data


@pytest.mark.parametrize(
    "policy,blocked", [("error", True), ("sandbox_wins", False)], ids=["error", "sandbox_wins"]
)
def test_pull_delete_vs_modify(policy: str, blocked: bool, mgr: Manager) -> None:
    """Sandbox xóa + VFS sửa: 'error' chặn (kho giữ nguyên); 'sandbox_wins' xóa file kho."""
    sid = _started(mgr, policy=policy)
    volume = _volume(mgr, sid)
    _write(mgr, sid, **{"a.txt": "kho sửa\n"})  # VFS sửa sau khi đã push
    (volume / "a.txt").unlink()  # sandbox xóa

    if blocked:
        with pytest.raises(AppError) as exc:
            _pull(mgr, sid)
        assert exc.value.code.value == "conflict"
        assert exc.value.details["conflicts"][0]["kind"] == "delete_vs_modify"
        assert _with_vfs(mgr, sid, lambda v: v.read_file("a.txt")) == "kho sửa\n".encode()
        return

    r = _pull(mgr, sid)
    assert r["conflicts"][0]["kind"] == "delete_vs_modify"
    assert {"path": "a.txt", "kind": "delete"} in r["applied"]

    def check(v) -> dict | None:
        assert v.get_file_info("a.txt") is None
        return v.tombstone_info("a.txt")

    assert _with_vfs(mgr, sid, check)["origin"] == "sandbox"


def test_pull_tombstone_origin_sandbox_when_sandbox_loses_pushed_file(mgr: Manager) -> None:
    """Sandbox vắng file đã push (kho không đổi) → xóa kho, tombstone origin='sandbox'."""
    sid = _started(mgr)
    (_volume(mgr, sid) / "a.txt").unlink()

    r = _pull(mgr, sid)

    assert {"path": "a.txt", "kind": "delete"} in r["applied"]
    assert r["conflicts"] == []

    def check(v) -> dict | None:
        assert v.get_file_info("a.txt") is None
        return v.tombstone_info("a.txt")

    tomb = _with_vfs(mgr, sid, check)
    assert tomb["origin"] == "sandbox" and tomb["sha256"] == hashlib.sha256(b"v1\n").hexdigest()


def test_pull_does_not_retrigger_push_candidates(mgr: Manager) -> None:
    """Không ping-pong: file vừa nhận về có synced == sha → push_candidates không chọn lại."""
    sid = _started(mgr)
    (_volume(mgr, sid) / "a.txt").write_text("bản sandbox\n")
    assert _pull(mgr, sid)["pulled"] is True

    state = mgr.store.get_sync_state(_sandbox_id(mgr, sid))

    def check(v) -> bool:
        puts, dels = v.push_candidates(state["last_synced_revision"])
        return "a.txt" not in puts and "a.txt" not in dels

    assert _with_vfs(mgr, sid, check)


# ------------------------------------------------------------ W3 guard trước push


def test_push_guard_error_policy_blocks_all_sends(mgr: Manager) -> None:
    """Sandbox sửa X + VFS sửa X, policy 'error' → push bị chặn TRƯỚC KHI gửi bất cứ gì."""
    sid = _started(mgr, policy="error")
    volume = _volume(mgr, sid)
    (volume / "a.txt").write_text("sandbox sửa\n")  # sandbox đổi a.txt (chưa về kho)
    _write(mgr, sid, **{"a.txt": "kho sửa\n", "c.txt": "mới\n"})  # kho cũng đổi a.txt + thêm c.txt

    with pytest.raises(AppError) as exc:
        mgr.sync_push(sid)
    assert exc.value.code.value == "conflict"
    assert exc.value.details["guarded"] == [{"path": "a.txt", "kind": "put"}]
    assert (volume / "a.txt").read_text() == "sandbox sửa\n"
    assert not (volume / "c.txt").exists()  # không gửi gì cả


def test_push_guard_sandbox_wins_skips_guarded_but_sends_rest(mgr: Manager) -> None:
    """Policy 'sandbox_wins': bỏ path bị guard (không gửi), vẫn gửi phần còn lại; bản sandbox về kho qua pull."""
    sid = _started(mgr)  # sandbox_wins
    volume = _volume(mgr, sid)
    (volume / "a.txt").write_text("sandbox sửa\n")
    _write(mgr, sid, **{"a.txt": "kho sửa\n", "c.txt": "mới\n"})

    r = mgr.sync_push(sid)
    assert r["guarded"] == [{"path": "a.txt", "kind": "put"}]
    assert r["put"] == 1  # chỉ c.txt được gửi
    assert (volume / "c.txt").exists()
    assert (volume / "a.txt").read_text() == "sandbox sửa\n"  # bản sandbox không bị đè

    r2 = _pull(mgr, sid)  # bản sandbox thắng sẽ về kho
    assert r2["conflicts"][0]["kind"] == "modify_vs_modify"
    assert {"path": "a.txt", "kind": "update"} in r2["applied"]
    assert _with_vfs(mgr, sid, lambda v: v.read_file("a.txt")) == "sandbox sửa\n".encode()


def test_push_guard_full_bypasses_guard(mgr: Manager) -> None:
    """full=True là sửa chữa — VFS thắng, bỏ qua guard, gửi hết kể cả path sandbox đã sửa."""
    sid = _started(mgr, policy="error")
    volume = _volume(mgr, sid)
    (volume / "a.txt").write_text("sandbox sửa\n")
    _write(mgr, sid, **{"a.txt": "kho sửa\n"})

    r = mgr.sync_push(sid, full=True)
    assert r["put"] == 2  # a.txt + old.txt
    assert (volume / "a.txt").read_text() == "kho sửa\n"


def test_push_guard_ignores_new_vfs_files(mgr: Manager) -> None:
    """File mới của kho (chưa từng có trong sandbox) không bị guard chặn — push bình thường."""
    sid = _started(mgr, policy="error")
    volume = _volume(mgr, sid)
    _write(mgr, sid, **{"fresh.txt": "file mới của kho\n"})

    r = mgr.sync_push(sid)
    assert r["guarded"] == [] and r["put"] == 1
    assert (volume / "fresh.txt").read_text() == "file mới của kho\n"
