"""Trình thực thi trong sandbox (exec agent, §5.5 + mcp-integration §3.9): gRPC server.

Chạy làm tiến trình chính của container:
``python -m sandbox_kit_clone.agent --root /workspace --port 50051``.

- ``Exec``: chạy ``bash -lc <command>`` trong ``root`` (hoặc ``cwd`` con của root), gửi
  stdout/stderr về ngay khi có (từng đoạn ≤ 64KB), sự kiện cuối là ``Exit``. Hết giờ → kill
  cả nhóm tiến trình (lệnh con, lệnh nền) rồi trả ``timed_out``. Client hủy RPC → kill luôn.
- ``SyncFiles``: nhận loạt put/delete; mỗi file ghi ra file tạm cùng thư mục → kiểm sha256 +
  kích thước → ``os.replace`` (nguyên tử: sandbox không bao giờ thấy file ghi dở). Trả xác nhận
  cho TỪNG thao tác; một file lỗi không làm hỏng các file khác.
- ``ListFiles``: liệt kê file thường trong root (bỏ các thư mục được chỉ định), kèm sha256.
- ``PullFiles``: stream nội dung file từ sandbox về kho (pull-back): FileStart → data → FileEnd
  theo từng path; path không đọc được → sự kiện Missing và đi tiếp file sau.
- ``Healthcheck``: còn sống, gốc workspace, số lệnh đang chạy.

Agent KHÔNG biết VFS, KHÔNG tự quyết xung đột (§5.5). Module này chỉ phụ thuộc grpc +
protobuf (không import phần còn lại của sandbox_kit_clone) để đóng gói gọn vào image.
"""

from __future__ import annotations

import hashlib
import logging
import os
import queue
import signal
import subprocess
import threading
import time
import uuid
from concurrent import futures
from pathlib import Path

import grpc

from sandbox_kit_clone.agent.proto import sandbox_agent_pb2 as pb
from sandbox_kit_clone.agent.proto import sandbox_agent_pb2_grpc as pb_grpc

AGENT_VERSION = "w2.2"
DEFAULT_TIMEOUT_SECONDS = 120
MAX_TIMEOUT_SECONDS = 3600
READ_CHUNK = 64 * 1024
PULL_CHUNK = 1024 * 1024  # 1MB mỗi đoạn PullFiles (khớp SYNC_CHUNK phía client)
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


class _PathError(ValueError):
    pass


def _resolve_file(root: Path, rel: str) -> Path:
    """Đường dẫn file đích trong root. Chặn tuyệt đối / ``..`` / thư mục cha là symlink ra ngoài.

    Bản thân file đích là symlink thì không theo: ``os.replace`` thay chính symlink đó.
    """
    if not rel or rel.startswith("/") or "\0" in rel:
        raise _PathError("đường dẫn phải tương đối và khác rỗng")
    parts = rel.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise _PathError("đường dẫn không được chứa '.', '..' hoặc '//'")
    parent = (root / "/".join(parts[:-1])).resolve() if len(parts) > 1 else root
    if not parent.is_relative_to(root):
        raise _PathError("đường dẫn thoát ra ngoài workspace")
    return parent / parts[-1]


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


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

    def SyncFiles(self, request_iterator, context):
        started = time.monotonic()
        acks: list = []
        written = 0
        cur: dict | None = None  # file đang nhận: path, target, tmp, fh, hasher, size, error

        def finish(entry: dict) -> None:
            nonlocal written
            fh = entry.get("fh")
            if fh is not None:
                fh.flush()
                os.fsync(fh.fileno())
                fh.close()
            tmp: Path | None = entry.get("tmp")
            error = entry.get("error")
            sha = entry["hasher"].hexdigest() if entry.get("hasher") else ""
            if error is None and entry["got"] != entry["size"]:
                error = f"kích thước {entry['got']} khác khai báo {entry['size']}"
            if error is None and entry["sha256"] and sha != entry["sha256"]:
                error = "sha256 không khớp"
            if error is None:
                try:
                    os.replace(tmp, entry["target"])
                    written += entry["got"]
                except OSError as exc:
                    error = f"không ghi được: {exc}"
            if error is not None and tmp is not None:
                tmp.unlink(missing_ok=True)
            acks.append(pb.FileAck(path=entry["path"], op=pb.FileAck.PUT, ok=error is None,
                                   sha256=sha if error is None else "", error=error or ""))

        for msg in request_iterator:
            kind = msg.WhichOneof("msg")
            if kind == "start":
                if cur is not None:
                    cur["error"] = cur.get("error") or "thiếu FileEnd"
                    finish(cur)
                cur = {"path": msg.start.path, "size": msg.start.size, "sha256": msg.start.sha256, "got": 0}
                try:
                    target = _resolve_file(self.root, msg.start.path)
                    if target.is_dir() and not target.is_symlink():
                        raise _PathError("đích là thư mục")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    tmp = target.parent / f".skc-sync-{uuid.uuid4().hex}.tmp"
                    fh = open(tmp, "wb")  # noqa: SIM115 — mở xuyên nhiều message, finish() đóng
                    cur.update(target=target, tmp=tmp, fh=fh, hasher=hashlib.sha256())
                except (OSError, _PathError) as exc:
                    cur["error"] = str(exc)
            elif kind == "data":
                if cur is None:
                    continue
                cur["got"] += len(msg.data)
                if cur.get("fh") is not None and cur.get("error") is None:
                    cur["fh"].write(msg.data)
                    cur["hasher"].update(msg.data)
            elif kind == "end":
                if cur is not None:
                    finish(cur)
                    cur = None
            elif kind == "delete":
                path = msg.delete.path
                try:
                    target = _resolve_file(self.root, path)
                    if target.is_dir() and not target.is_symlink():
                        raise _PathError("đích là thư mục")
                    target.unlink(missing_ok=True)  # không có sẵn → coi như đã xóa (chạy lại an toàn)
                    acks.append(pb.FileAck(path=path, op=pb.FileAck.DELETE, ok=True))
                except (OSError, _PathError) as exc:
                    acks.append(pb.FileAck(path=path, op=pb.FileAck.DELETE, ok=False, error=str(exc)))
        if cur is not None:
            cur["error"] = cur.get("error") or "luồng đóng trước FileEnd"
            finish(cur)
        log.info("sync %d thao tác, %d byte", len(acks), written)
        return pb.SyncReply(acks=acks, bytes_written=written,
                            duration_ms=int((time.monotonic() - started) * 1000))

    def ListFiles(self, request, context):
        exclude = set(request.exclude_dirs)
        count = 0
        for dirpath, dirnames, filenames in os.walk(self.root, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if d not in exclude)
            for name in sorted(filenames):
                if name.startswith(".skc-sync-"):
                    continue
                full = Path(dirpath) / name
                try:
                    st = full.lstat()
                except OSError:
                    continue
                if not os.path.isfile(full) or full.is_symlink():
                    continue
                entry = pb.FileEntry(
                    path=full.relative_to(self.root).as_posix(), size=st.st_size, mtime_ns=st.st_mtime_ns
                )
                if request.with_sha256:
                    try:
                        entry.sha256 = _sha256_file(full)
                    except OSError:
                        continue
                yield entry
                count += 1
                if request.limit and count >= request.limit:
                    return

    def PullFiles(self, request, context):
        """Pull-back (W3): stream nội dung từng path về kho; lỗi một file không làm hỏng file khác."""
        for rel in request.paths:
            try:
                target = _resolve_file(self.root, rel)
                if target.is_symlink() or not target.is_file():
                    raise _PathError("không phải file thường")
                st = target.stat()
                sha = _sha256_file(target)
            except (OSError, _PathError) as exc:
                yield pb.PullEvent(missing=pb.Missing(path=rel, error=str(exc)))
                continue
            yield pb.PullEvent(start=pb.FileStart(path=rel, size=st.st_size, sha256=sha))
            try:
                with open(target, "rb") as f:
                    for chunk in iter(lambda: f.read(PULL_CHUNK), b""):
                        yield pb.PullEvent(data=chunk)
            except OSError as exc:  # file biến mất giữa lúc stat và lúc đọc
                yield pb.PullEvent(missing=pb.Missing(path=rel, error=str(exc)))
                continue
            yield pb.PullEvent(end=pb.FileEnd())
        log.info("pull %d path", len(request.paths))

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
