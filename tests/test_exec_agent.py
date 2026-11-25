"""Trình thực thi gRPC + command_run (W2): agent chạy local, Manager, REST stream, MCP thật.

Không cần Docker: agent chạy trên máy với gốc là thư mục tạm (FakeProvider(exec_host=True)).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from sandbox_kit_clone.agent.server import build_server
from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError
from sandbox_kit_clone.gateway.app import create_app
from sandbox_kit_clone.manager.exec_client import ExecClient
from sandbox_kit_clone.providers.fake import FakeProvider

# ------------------------------------------------------------------ agent


@pytest.fixture()
def agent(tmp_path: Path):
    root = tmp_path / "ws"
    (root / "sub").mkdir(parents=True)
    (root / "a.txt").write_text("hello\n")
    server, port = build_server(root, "127.0.0.1:0", max_workers=4)
    server.start()
    client = ExecClient(f"127.0.0.1:{port}")
    client.wait_ready(5)
    yield client
    client.close()
    server.stop(0)


def test_health(agent: ExecClient) -> None:
    reply = agent.health()
    assert reply.version and reply.workspace_root.endswith("ws") and reply.running == 0


def test_exit_code_stdout_stderr(agent: ExecClient) -> None:
    r = agent.run("cat a.txt; echo oops >&2; exit 3")
    assert (r.exit_code, r.stdout, r.stderr, r.timed_out) == (3, b"hello\n", b"oops\n", False)


def test_output_streams_while_running(agent: ExecClient) -> None:
    stamps: list[float] = []
    t0 = time.monotonic()
    agent.run("echo a; sleep 0.6; echo b", on_output=lambda _s, _d: stamps.append(time.monotonic() - t0))
    assert len(stamps) == 2 and stamps[0] < 0.4 and stamps[1] >= 0.5  # đoạn đầu tới TRƯỚC khi lệnh xong


def test_timeout_kills_whole_process_group(agent: ExecClient, tmp_path: Path) -> None:
    marker = tmp_path / "ws" / "late.txt"
    r = agent.run("(sleep 2; touch late.txt) & sleep 30", timeout_seconds=1)
    assert r.timed_out and r.exit_code < 0 and r.duration_ms < 5000
    time.sleep(2.5)
    assert not marker.exists()  # lệnh nền cũng đã bị kill


def test_cwd_env_and_escape(agent: ExecClient) -> None:
    assert agent.run("pwd", cwd="sub").stdout.decode().rstrip().endswith("ws/sub")
    assert agent.run("echo $GREETING", env={"GREETING": "xin chào"}).stdout == "xin chào\n".encode()
    for bad in ("../..", "/etc", "khong-co"):
        r = agent.run("pwd", cwd=bad)
        assert r.exit_code == -1 and r.error
    assert agent.run("   ").error == "command rỗng"


def test_output_cap_keeps_tail(agent: ExecClient) -> None:
    r = agent.run("seq 1 200000", max_output_bytes=100)
    assert r.truncated and r.stdout_bytes > 1_000_000 and len(r.stdout) == 100
    assert r.stdout.endswith(b"200000\n")


def test_unreachable_agent_is_clear_error() -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with pytest.raises(AppError) as exc:
        ExecClient(f"127.0.0.1:{port}").wait_ready(timeout=1)
    assert exc.value.code.value == "agent_unavailable"


def test_pull_files_streams_content_and_sha(agent: ExecClient, tmp_path: Path) -> None:
    """Pull-back (W3): nội dung + sha256 + size khớp file gốc, đúng thứ tự, file >1MB nhiều đoạn."""
    root = tmp_path / "ws"
    big = os.urandom(2_500_000)  # > 1MB → agent cắt nhiều đoạn data
    (root / "sub" / "b.txt").write_text("nội dung file con\n")
    (root / "big.bin").write_bytes(big)
    pulled = list(agent.pull(["a.txt", "sub/b.txt", "big.bin"]))
    assert [p.path for p in pulled] == ["a.txt", "sub/b.txt", "big.bin"]
    assert all(p.error == "" for p in pulled)
    chunks_per_file = [list(p.chunks()) for p in pulled]  # chunks() gọi đúng một lần mỗi file
    for p, chunks, original in zip(pulled, chunks_per_file, [b"hello\n", "nội dung file con\n".encode(), big]):
        assert p.size == len(original)
        assert p.sha256 == hashlib.sha256(original).hexdigest()
        assert b"".join(chunks) == original
    # file lớn phải được cắt thành nhiều đoạn (mỗi đoạn ≤ 1MB)
    assert len(chunks_per_file[2]) >= 3 and all(len(c) <= 1024 * 1024 for c in chunks_per_file[2])


def test_pull_files_missing_path(agent: ExecClient, tmp_path: Path) -> None:
    """Path không tồn tại / chứa ``..`` → Missing; các file khác vẫn nhận đủ, đúng thứ tự."""
    (tmp_path / "ws" / "sub" / "b.txt").write_text("file còn lại\n")
    pulled = list(agent.pull(["a.txt", "../ngoai.txt", "khong-co.txt", "sub/b.txt"]))
    assert [p.path for p in pulled] == ["a.txt", "../ngoai.txt", "khong-co.txt", "sub/b.txt"]
    assert pulled[0].error == "" and b"".join(pulled[0].chunks()) == b"hello\n"
    assert pulled[3].error == "" and b"".join(pulled[3].chunks()) == "file còn lại\n".encode()
    for bad in (pulled[1], pulled[2]):
        assert bad.error and bad.size == 0 and bad.sha256 == ""


# ------------------------------------------------------- Manager + REST


def _app(tmp_path: Path, exec_host: bool = True):
    settings = Settings(data_dir=str(tmp_path / "data"))
    provider = FakeProvider(base_dir=tmp_path / "fake", exec_host=exec_host)
    return create_app(settings=settings, provider=provider)


@pytest.fixture()
def app(tmp_path: Path):
    app = _app(tmp_path)
    yield app
    for sid in list(app.state.provider.list_sandboxes()):
        app.state.provider.terminate_sandbox(sid)


def _running_session(app) -> str:
    tools = app.state.tool_fns
    sid = tools["workspace_create"](name="exec")["session_id"]
    tools["file_write"](session_id=sid, path="src/app.py", content="print('từ VFS')\n")
    assert tools["sandbox_start"](session_id=sid)["state"] == "RUNNING"
    return sid


def test_gate_file_written_via_mcp_is_readable_by_command(app) -> None:
    """Gate W2 (phần đã làm được): ghi file qua MCP → bật sandbox → lệnh đọc được."""
    sid = _running_session(app)
    r = app.state.manager.command_run(sid, "cat src/app.py && python3 src/app.py")
    assert r["exit_code"] == 0 and r["stdout"] == "print('từ VFS')\ntừ VFS\n"
    assert r["sync"]["pushed"] is False
    ops = app.state.manager.store._conn.execute(
        "SELECT status FROM operations WHERE type = 'command_run'"
    ).fetchall()
    assert [o[0] for o in ops] == ["success"]


def test_command_run_state_and_input_checks(app, tmp_path: Path) -> None:
    manager = app.state.manager
    tools = app.state.tool_fns
    sid = tools["workspace_create"]()["session_id"]
    with pytest.raises(AppError, match="sandbox_start"):
        manager.command_run(sid, "true")  # chưa bật
    tools["sandbox_start"](session_id=sid)
    tools["sandbox_pause"](session_id=sid)
    with pytest.raises(AppError, match="sandbox_resume"):
        manager.command_run(sid, "true")
    tools["sandbox_resume"](session_id=sid)
    for bad in ({"command": ""}, {"command": "true", "timeout_seconds": 601}):
        with pytest.raises(AppError) as exc:
            manager.command_run(sid, **bad)
        assert exc.value.code.value == "invalid_request"
    with pytest.raises(AppError) as exc:
        manager.command_run("nope", "true")
    assert exc.value.code.value == "session_not_found"


def test_fake_without_exec_reports_capability(tmp_path: Path) -> None:
    app = _app(tmp_path, exec_host=False)
    tools = app.state.tool_fns
    sid = tools["workspace_create"]()["session_id"]
    tools["sandbox_start"](session_id=sid)
    with pytest.raises(AppError) as exc:
        app.state.manager.command_run(sid, "true")
    assert exc.value.code.value == "capability_unavailable"


def test_admin_exec_streams_ndjson(app) -> None:
    sid = _running_session(app)
    client = TestClient(app)
    with client.stream("POST", f"/admin/api/sessions/{sid}/exec", json={"command": "echo 1; echo 2 >&2"}) as res:
        assert res.status_code == 200
        events = [json.loads(line) for line in res.iter_lines() if line]
    outputs = [(e["stream"], e["text"]) for e in events if e["type"] == "output"]
    assert ("stdout", "1\n") in outputs and ("stderr", "2\n") in outputs
    assert events[-1]["type"] == "result" and events[-1]["exit_code"] == 0
    with client.stream("POST", "/admin/api/sessions/nope/exec", json={"command": "true"}) as res:
        last = [json.loads(line) for line in res.iter_lines() if line][-1]
    assert last["type"] == "error" and last["error"]["code"] == "session_not_found"


# ------------------------------------------------------------ MCP thật


def test_mcp_command_run_streams_log_notifications(app) -> None:
    asyncio.run(_mcp_flow(app))


async def _mcp_flow(app) -> None:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    logs: list[tuple[str, str, float]] = []
    t0 = time.monotonic()

    async def on_log(params) -> None:
        logs.append((params.logger, params.data, time.monotonic() - t0))

    try:
        async with (
            streamablehttp_client(f"http://127.0.0.1:{port}/mcp") as (read, write, _),
            ClientSession(read, write, logging_callback=on_log) as session,
        ):
            await session.initialize()
            assert "command_run" in {t.name for t in (await session.list_tools()).tools}

            def payload(result):
                if result.structuredContent is not None:
                    return result.structuredContent
                return json.loads(result.content[0].text)

            sid = payload(await session.call_tool("workspace_create", {}))["session_id"]
            await session.call_tool("sandbox_start", {"session_id": sid})
            t0 = time.monotonic()
            result = payload(await session.call_tool("command_run", {
                "session_id": sid, "command": "echo đầu; sleep 0.8; echo cuối >&2; exit 4",
            }))
            assert result["exit_code"] == 4 and result["stdout"] == "đầu\n" and result["stderr"] == "cuối\n"
            assert ("stdout", "đầu\n") in [(lg, d) for lg, d, _ in logs]
            assert ("stderr", "cuối\n") in [(lg, d) for lg, d, _ in logs]
            first = next(at for lg, d, at in logs if d == "đầu\n")
            assert first < 0.7  # tới tay client TRƯỚC khi lệnh kết thúc
            err = payload(await session.call_tool("command_run", {"session_id": "nope", "command": "true"}))
            assert err["error"]["code"] == "session_not_found"
    finally:
        server.should_exit = True
        await task
