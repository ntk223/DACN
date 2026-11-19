"""gRPC client Manager → trình thực thi trong sandbox (§5.5).

- Một channel cho mỗi sandbox (``ExecClientPool``), đóng khi sandbox bị xóa.
- ``wait_ready``: chờ agent trả Healthcheck, tối đa 90 giây (§5.5) → ``agent_unavailable``.
- Mất kết nối trước khi lệnh kịp chạy → nối lại đúng MỘT lần (che tình huống tạm dừng / tiếp tục).
  Đã nhận output rồi mà đứt → không chạy lại (tránh chạy lệnh hai lần), báo lỗi.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import grpc

from sandbox_kit_clone.agent.proto import sandbox_agent_pb2 as pb
from sandbox_kit_clone.agent.proto import sandbox_agent_pb2_grpc as pb_grpc
from sandbox_kit_clone.errors import AppError, ErrorCode

READY_TIMEOUT_SECONDS = 90.0
_RETRYABLE = (grpc.StatusCode.UNAVAILABLE,)


@dataclass
class ExecResult:
    exit_code: int
    timed_out: bool
    duration_ms: int
    error: str = ""
    stdout: bytes = b""
    stderr: bytes = b""
    stdout_bytes: int = 0
    stderr_bytes: int = 0
    truncated: bool = False
    extra: dict = field(default_factory=dict)


class _TailBuffer:
    """Giữ tối đa ``limit`` byte CUỐI (kết quả lệnh dài: phần cuối thường là phần cần đọc)."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.buf = bytearray()
        self.total = 0

    def add(self, data: bytes) -> None:
        self.total += len(data)
        self.buf += data
        if len(self.buf) > self.limit:
            del self.buf[: len(self.buf) - self.limit]

    @property
    def truncated(self) -> bool:
        return self.total > len(self.buf)


class ExecClient:
    def __init__(self, target: str) -> None:
        self.target = target
        self._channel = grpc.insecure_channel(target)
        self._stub = pb_grpc.ExecAgentStub(self._channel)

    def close(self) -> None:
        self._channel.close()

    def _reconnect(self) -> None:
        self._channel.close()
        self._channel = grpc.insecure_channel(self.target)
        self._stub = pb_grpc.ExecAgentStub(self._channel)

    def health(self, timeout: float = 3.0) -> pb.HealthReply:
        return self._stub.Healthcheck(pb.HealthRequest(), timeout=timeout)

    def wait_ready(self, timeout: float = READY_TIMEOUT_SECONDS) -> pb.HealthReply:
        deadline = time.monotonic() + timeout
        last: Exception | None = None
        while time.monotonic() < deadline:
            try:
                return self.health(timeout=min(3.0, max(0.2, deadline - time.monotonic())))
            except grpc.RpcError as exc:
                last = exc
                time.sleep(0.3)
        raise AppError(
            ErrorCode.agent_unavailable,
            f"Trình thực thi tại {self.target} không phản hồi sau {timeout:.0f}s",
            details={"last_error": str(getattr(last, "details", lambda: last)())},
        )

    def stream(self, request: pb.ExecRequest, deadline_s: float) -> Iterator[pb.ExecEvent]:
        """Các sự kiện của một lần Exec; tự nối lại một lần nếu chưa nhận được gì."""
        for attempt in (1, 2):
            received = False
            try:
                for event in self._stub.Exec(request, timeout=deadline_s, wait_for_ready=attempt == 2):
                    received = True
                    yield event
                return
            except grpc.RpcError as exc:
                if exc.code() in _RETRYABLE and not received and attempt == 1:
                    self._reconnect()
                    continue
                if exc.code() == grpc.StatusCode.DEADLINE_EXCEEDED:
                    raise AppError(ErrorCode.agent_unavailable, "Mất liên lạc với trình thực thi (quá hạn chờ)") from exc
                raise AppError(
                    ErrorCode.agent_unavailable,
                    f"Mất kết nối trình thực thi: {exc.code().name} {exc.details()}",
                ) from exc

    def run(
        self,
        command: str,
        cwd: str = "",
        env: dict[str, str] | None = None,
        timeout_seconds: int = 120,
        request_id: str = "",
        on_output: Callable[[str, bytes], None] | None = None,
        max_output_bytes: int = 1024 * 1024,
    ) -> ExecResult:
        """Chạy lệnh tới khi xong; ``on_output(stream, data)`` gọi ngay mỗi đoạn output."""
        request = pb.ExecRequest(
            command=command,
            cwd=cwd,
            env=env or {},
            timeout_seconds=timeout_seconds,
            request_id=request_id,
        )
        out, err = _TailBuffer(max_output_bytes), _TailBuffer(max_output_bytes)
        exit_event = None
        # Deadline RPC = timeout lệnh + thời gian agent kill & dọn.
        for event in self.stream(request, deadline_s=timeout_seconds + 15):
            kind = event.WhichOneof("event")
            if kind == "output":
                name = "stderr" if event.output.stream == pb.Output.STDERR else "stdout"
                (err if name == "stderr" else out).add(event.output.data)
                if on_output is not None:
                    on_output(name, event.output.data)
            elif kind == "exit":
                exit_event = event.exit
        if exit_event is None:
            raise AppError(ErrorCode.agent_unavailable, "Trình thực thi đóng luồng mà không báo kết quả")
        return ExecResult(
            exit_code=exit_event.exit_code,
            timed_out=exit_event.timed_out,
            duration_ms=exit_event.duration_ms,
            error=exit_event.error,
            stdout=bytes(out.buf),
            stderr=bytes(err.buf),
            stdout_bytes=out.total,
            stderr_bytes=err.total,
            truncated=out.truncated or err.truncated,
        )


class ExecClientPool:
    """Một ``ExecClient`` cho mỗi sandbox; thread-safe."""

    def __init__(self) -> None:
        self._clients: dict[str, ExecClient] = {}
        self._lock = threading.Lock()

    def get(self, sandbox_id: str, target: str) -> ExecClient:
        with self._lock:
            client = self._clients.get(sandbox_id)
            if client is not None and client.target != target:
                client.close()
                client = None
            if client is None:
                client = self._clients[sandbox_id] = ExecClient(target)
            return client

    def drop(self, sandbox_id: str) -> None:
        with self._lock:
            client = self._clients.pop(sandbox_id, None)
        if client is not None:
            client.close()
