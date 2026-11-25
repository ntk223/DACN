"""Bộ giả lập provider (§5.3): chạy trong bộ nhớ, cùng bộ khung — test không cần Docker.

Chỉ mô phỏng lifecycle + workspace seed + dial target. Không có exec thật, không có
đồng bộ file thật (W2 mới làm). Toàn bộ state giữ trong bộ nhớ; thư mục volume là
hiện thực trên đĩa để kiểm tra việc seed mã nguồn.
"""

from __future__ import annotations

import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import ClassVar

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.providers.base import SandboxProvider

DEFAULT_BASE_DIR = Path("data/fake-sandboxes")
_FIRST_DIAL_PORT = 50_000


def _utc_now() -> datetime:
    """Thời điểm hiện tại theo UTC (timezone-aware)."""
    return datetime.now(UTC)


@dataclass
class _FakeSandbox:
    """Trạng thái nội bộ của một sandbox giả lập."""

    session_id: str
    image: str
    state: str  # "created" | "running" | "paused" | "stopped"
    created_at: str  # UTC ISO
    expires_at: datetime | None  # None = không hết hạn (fail-safe)
    dial_port: int
    volume_path: Path | None
    agent: object | None = None  # grpc.Server khi exec_host=True


class FakeProvider(SandboxProvider):
    """Hiện thực in-memory của ``SandboxProvider`` — đủ dùng cho toàn bộ tool surface W1."""

    name = "fake"
    capabilities: ClassVar[dict] = {
        "pause_resume": True,
        "metrics": False,
        "diagnostics": False,
        "isolation_tiers": ["runc"],
    }

    def __init__(self, base_dir: Path | None = None, exec_host: bool = False) -> None:
        """``exec_host=True``: mỗi sandbox giả chạy trình thực thi THẬT trên máy này, gốc là
        thư mục volume giả — lệnh chạy trực tiếp trên host, KHÔNG cô lập (chỉ dùng cho test/dev).
        """
        self.base_dir = base_dir if base_dir is not None else DEFAULT_BASE_DIR
        self.exec_host = exec_host
        self._sandboxes: dict[str, _FakeSandbox] = {}
        self._next_dial_port = _FIRST_DIAL_PORT

    # --- Lifecycle ---

    def create_sandbox(
        self,
        session_id: str,
        image: str,
        ttl_seconds: int,
        cpu: int | None = None,
        memory: int | None = None,
    ) -> str:
        """Dựng sandbox giả lập; nếu session đã có volume seed thì gắn kèm để terminate dọn."""
        sandbox_id = f"fake-{uuid.uuid4().hex[:8]}"
        now = _utc_now()
        # ttl <= 0 → coi như "không hết hạn" (fail-safe, kế thừa §5.4).
        expires_at = now + timedelta(seconds=ttl_seconds) if ttl_seconds > 0 else None
        volume = self._volume_dir(session_id)
        # Volume seed trước đó (prepare_workspace) được gắn vào sandbox lúc tạo.
        volume_path = volume if volume.is_dir() else None
        agent = None
        dial_port = self._next_dial_port
        if self.exec_host:
            from sandbox_kit_clone.agent.server import build_server

            volume.mkdir(parents=True, exist_ok=True)
            volume_path = volume
            agent, dial_port = build_server(volume, "127.0.0.1:0", max_workers=4)
            agent.start()
        self._sandboxes[sandbox_id] = _FakeSandbox(
            session_id=session_id,
            image=image,
            state="running",
            created_at=now.isoformat(),
            expires_at=expires_at,
            dial_port=dial_port,
            volume_path=volume_path,
            agent=agent,
        )
        self._next_dial_port += 1
        return sandbox_id

    def start_sandbox(self, sandbox_id: str) -> None:
        """Chạy lại sandbox đang đứng ngoài vòng đời; sandbox lạ → AppError."""
        sandbox = self._get_or_raise(sandbox_id)
        sandbox.state = "running"

    def terminate_sandbox(self, sandbox_id: str) -> None:
        """Hủy sandbox + dọn volume. An toàn khi gọi lại (idempotent, không raise)."""
        sandbox = self._sandboxes.pop(sandbox_id, None)
        if sandbox is None:
            return
        if sandbox.agent is not None:
            sandbox.agent.stop(grace=0)
        if sandbox.volume_path is not None:
            shutil.rmtree(sandbox.volume_path, ignore_errors=True)

    def pause_sandbox(self, sandbox_id: str) -> None:
        """Tạm dừng sandbox; sandbox lạ → AppError."""
        sandbox = self._get_or_raise(sandbox_id)
        sandbox.state = "paused"

    def resume_sandbox(self, sandbox_id: str) -> None:
        """Tiếp tục sandbox từ bất kỳ trạng thái nào → running; sandbox lạ → AppError."""
        sandbox = self._get_or_raise(sandbox_id)
        sandbox.state = "running"

    def renew_sandbox(self, sandbox_id: str, ttl_seconds: int) -> None:
        """Cộng thêm ttl vào hạn; sandbox "không hết hạn" giữ nguyên None. Sandbox lạ → AppError."""
        sandbox = self._get_or_raise(sandbox_id)
        if sandbox.expires_at is not None:
            sandbox.expires_at += timedelta(seconds=ttl_seconds)

    # --- Workspace seed + reachability ---

    def prepare_workspace(self, session_id: str, host_project_path: str) -> str:
        """Copy toàn bộ cây mã nguồn vào volume của session; trả path làm identifier.

        Volume còn sót từ lần chạy trước → xóa sạch rồi seed lại (không để file ma
        tồn dư "sống dậy" và lấn át nội dung seed).
        """
        source = Path(host_project_path)
        if not source.is_dir():
            raise AppError(
                ErrorCode.invalid_request,
                f"Đường dẫn mã nguồn không tồn tại hoặc không phải thư mục: {host_project_path}",
            )
        volume = self._volume_dir(session_id)
        # File lạ từ lần chạy trước sẽ sống sót qua copytree(dirs_exist_ok=True)
        # → xóa hẳn thư mục volume rồi tạo mới, volume luôn sạch = đúng nội dung seed.
        if volume.is_dir():
            shutil.rmtree(volume)
        volume.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, volume, dirs_exist_ok=True)
        return str(volume)

    def get_dial_target(self, sandbox_id: str) -> str:
        """Địa chỉ host:port để nối vào exec agent; sandbox lạ → AppError.

        Không bật ``exec_host`` → địa chỉ giả (không có gì lắng nghe) — ``has_exec_agent`` báo False.
        """
        sandbox = self._get_or_raise(sandbox_id)
        return f"127.0.0.1:{sandbox.dial_port}"

    def has_exec_agent(self, sandbox_id: str) -> bool:
        return self._get_or_raise(sandbox_id).agent is not None

    def list_sandboxes(self) -> list[str]:
        """Mọi sandbox đang sống (sandbox đã terminate bị xóa khỏi dict nên không còn)."""
        return list(self._sandboxes)

    # --- Helper test/debug ---

    def get_sandbox_state(self, sandbox_id: str) -> str:
        """Trạng thái hiện tại của sandbox; sandbox lạ → AppError."""
        return self._get_or_raise(sandbox_id).state

    def is_expired(self, sandbox_id: str, now: datetime | None = None) -> bool:
        """Sandbox hết hạn chưa? expires_at là None → luôn False (fail-safe)."""
        sandbox = self._get_or_raise(sandbox_id)
        if sandbox.expires_at is None:
            return False
        return sandbox.expires_at <= (now if now is not None else _utc_now())

    def get_expiry(self, sandbox_id: str) -> datetime | None:
        return self._get_or_raise(sandbox_id).expires_at

    def describe_sandbox(self, sandbox_id: str) -> dict:
        """Thông tin gọn cho trang quản trị — cùng khóa với ``DockerProvider``."""
        sandbox = self._get_or_raise(sandbox_id)
        return {
            "sandbox_id": sandbox_id,
            "session_id": sandbox.session_id,
            "state": sandbox.state,
            "image": sandbox.image,
            "created_at": sandbox.created_at,
            "expires_at": sandbox.expires_at.isoformat() if sandbox.expires_at else None,
            "dial_target": f"127.0.0.1:{sandbox.dial_port}",
            "volume": str(sandbox.volume_path) if sandbox.volume_path else None,
        }

    def list_workspace_files(self, sandbox_id: str, limit: int = 500) -> dict:
        """File trong volume giả lập (debug: kiểm việc nạp mã nguồn)."""
        sandbox = self._get_or_raise(sandbox_id)
        files: list[dict] = []
        if sandbox.volume_path is not None and sandbox.volume_path.is_dir():
            for f in sorted(sandbox.volume_path.rglob("*")):
                if f.is_file():
                    files.append({"path": f.relative_to(sandbox.volume_path).as_posix(), "size": f.stat().st_size})
        return {"files": files[:limit], "total": len(files), "truncated": len(files) > limit}

    def read_workspace_file(self, sandbox_id: str, path: str, max_bytes: int = 256 * 1024) -> dict:
        sandbox = self._get_or_raise(sandbox_id)
        root = sandbox.volume_path
        target = (root / path).resolve() if root is not None else None
        if root is None or target is None or not target.is_relative_to(root.resolve()) or not target.is_file():
            raise AppError(ErrorCode.file_not_found, f"Không có '{path}' trong sandbox")
        data = target.read_bytes()
        return {"path": path, "size": len(data), "content": data[:max_bytes], "truncated": len(data) > max_bytes}

    def cleanup_workspace(self, session_id: str) -> None:
        """Dọn volume của session khi tạo sandbox thất bại (idempotent)."""
        shutil.rmtree(self._volume_dir(session_id), ignore_errors=True)

    # --- Nội bộ ---

    def _volume_dir(self, session_id: str) -> Path:
        """Thư mục volume của session (chưa chắc tồn tại)."""
        return self.base_dir / "volumes" / session_id

    def _get_or_raise(self, sandbox_id: str) -> _FakeSandbox:
        """Lấy sandbox theo id; không tồn tại → AppError(invalid_request)."""
        sandbox = self._sandboxes.get(sandbox_id)
        if sandbox is None:
            raise AppError(
                ErrorCode.invalid_request,
                f"Sandbox không tồn tại hoặc đã bị hủy: {sandbox_id}",
            )
        return sandbox
