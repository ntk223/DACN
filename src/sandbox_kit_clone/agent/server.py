"""Trình thực thi trong sandbox (exec agent, §5.5 + mcp-integration §3.9): gRPC server.

Chạy làm tiến trình chính của container:
``python -m sandbox_kit_clone.agent --root /workspace --port 50051``.

- ``Exec``: chạy ``bash -lc <command>`` trong ``root`` (hoặc ``cwd`` con của root), gửi
  stdout/stderr về ngay khi có (từng đoạn ≤ 64KB), sự kiện cuối là ``Exit``. Hết giờ → kill
  cả nhóm tiến trình (lệnh con, lệnh nền) rồi trả ``timed_out``. Client hủy RPC → kill luôn.
- ``Healthcheck``: còn sống, gốc workspace, số lệnh đang chạy.

Agent KHÔNG biết VFS, KHÔNG tự quyết xung đột (§5.5). Module này chỉ phụ thuộc grpc +
protobuf (không import phần còn lại của sandbox_kit_clone) để đóng gói gọn vào image.
"""

from __future__ import annotations

import logging
import os
import queue
import signal
import subprocess
import threading
import time
from concurrent import futures
from pathlib import Path

import grpc

from sandbox_kit_clone.agent.proto import sandbox_agent_pb2 as pb
from sandbox_kit_clone.agent.proto import sandbox_agent_pb2_grpc as pb_grpc

AGENT_VERSION = "w2.1"
DEFAULT_TIMEOUT_SECONDS = 120
MAX_TIMEOUT_SECONDS = 3600
READ_CHUNK = 64 * 1024
KILL_GRACE_SECONDS = 2.0

log = logging.getLogger("sandbox_kit_clone.agent")


class _CwdError(ValueError):
    pass


def _resolve_cwd(root: Path, cwd: str) -> Path:
    """``cwd`` tương đối với root; chặn ``..`` / đường tuyệt đối / symlink thoát ra ngoài."""
    if not cwd or cwd in (".", "/"):
        return root
    candidate = (root / cwd.lstrip("/")).resolve()
    if not candidate.is_relative_to(root):
        raise _CwdError(f"cwd '{cwd}' nằm ngoài workspace")
    if not candidate.is_dir():
        raise _CwdError(f"cwd '{cwd}' không tồn tại hoặc không phải thư mục")
    return candidate


def _kill_group(proc: subprocess.Popen) -> None:
    """SIGTERM cả nhóm, chờ ngắn, rồi SIGKILL — dọn cả lệnh nền con cháu."""
    for sig, wait in ((signal.SIGTERM, KILL_GRACE_SECONDS), (signal.SIGKILL, None)):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        if wait is None:
            break
        try:
            proc.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


class ExecAgentServicer(pb_grpc.ExecAgentServicer):
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.started = time.monotonic()
        self._running = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ RPC

    def Healthcheck(self, request, context):
        return pb.HealthReply(
            version=AGENT_VERSION,
            workspace_root=str(self.root),
            uptime_ms=int((time.monotonic() - self.started) * 1000),
            running=self._running,
        )

    def Exec(self, request, context):
        started = time.monotonic()
        timeout = request.timeout_seconds if request.timeout_seconds > 0 else DEFAULT_TIMEOUT_SECONDS
        timeout = min(timeout, MAX_TIMEOUT_SECONDS)
        if not request.command.strip():
            yield _exit(-1, started, error="command rỗng")
            return
        try:
            cwd = _resolve_cwd(self.root, request.cwd)
        except _CwdError as exc:
            yield _exit(-1, started, error=str(exc))
            return

        env = dict(os.environ)
        env.update(request.env)
        env.setdefault("HOME", "/root")
        try:
            proc = subprocess.Popen(
                ["bash", "-lc", request.command],
                cwd=cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,  # nhóm tiến trình riêng → kill được cả cây
            )
        except OSError as exc:
            yield _exit(-1, started, error=f"không chạy được lệnh: {exc}")
            return

        with self._lock:
            self._running += 1
        log.info("exec start pid=%s req=%s cmd=%r", proc.pid, request.request_id, request.command[:200])
        events: queue.Queue = queue.Queue()
        readers = [
            threading.Thread(target=_pump, args=(proc.stdout, pb.Output.STDOUT, events), daemon=True),
            threading.Thread(target=_pump, args=(proc.stderr, pb.Output.STDERR, events), daemon=True),
        ]
        for t in readers:
            t.start()

        deadline = started + timeout
        timed_out = False
        open_streams = len(readers)
        try:
            while open_streams:
                if not context.is_active():  # client hủy / mất kết nối
                    _kill_group(proc)
                    return
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    _kill_group(proc)
                    remaining = KILL_GRACE_SECONDS + 1
                try:
                    item = events.get(timeout=min(remaining, 0.5))
                except queue.Empty:
                    continue
                if item is None:
                    open_streams -= 1
                    continue
                stream, data = item
                yield pb.ExecEvent(output=pb.Output(stream=stream, data=data))
            # Pipe đã đóng; lệnh nền có thể vẫn giữ tiến trình chính → chờ tới hạn rồi kill.
            try:
                proc.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                timed_out = True
                _kill_group(proc)
                proc.wait()
            yield _exit(proc.returncode, started, timed_out=timed_out)
        finally:
            if proc.poll() is None:
                _kill_group(proc)
            with self._lock:
                self._running -= 1
            log.info("exec end pid=%s rc=%s timed_out=%s", proc.pid, proc.returncode, timed_out)


def _pump(pipe, stream, events: queue.Queue) -> None:
    """Đọc pipe theo đoạn (không chờ đủ dòng) → hàng đợi; ``None`` = hết."""
    try:
        while True:
            data = pipe.read1(READ_CHUNK)
            if not data:
                break
            events.put((stream, data))
    finally:
        pipe.close()
        events.put(None)


def _exit(code: int, started: float, timed_out: bool = False, error: str = "") -> pb.ExecEvent:
    return pb.ExecEvent(
        exit=pb.Exit(
            exit_code=code,
            timed_out=timed_out,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=error,
        )
    )


def build_server(root: Path, address: str, max_workers: int = 16) -> tuple[grpc.Server, int]:
    """Dựng server (chưa start); trả ``(server, port thật)`` — ``address`` có thể dùng cổng 0."""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=max_workers))
    pb_grpc.add_ExecAgentServicer_to_server(ExecAgentServicer(root), server)
    port = server.add_insecure_port(address)
    if port == 0:
        raise RuntimeError(f"không mở được cổng {address}")
    return server, port


def serve(root: Path, host: str = "0.0.0.0", port: int = 50051) -> None:
    """Chạy tới khi nhận SIGTERM/SIGINT (container dừng)."""
    root.mkdir(parents=True, exist_ok=True)
    server, bound = build_server(root, f"{host}:{port}")
    server.start()
    log.info("agent %s lắng nghe %s:%s, root=%s", AGENT_VERSION, host, bound, root)
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    stop.wait()
    server.stop(grace=2).wait()
