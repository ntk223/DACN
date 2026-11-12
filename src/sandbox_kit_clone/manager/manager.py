"""Manager — bộ điều phối W1: nối VFS + SystemStore + Provider thành hệ thống chạy được.

Trách nhiệm (docs/system-design.md §3, §4):
- ``create_workspace``: sinh workspace_id + session_id, khởi tạo DB dự án, ghi sổ system.
- ``resolve_session``: tra phiên → mở VFS tương ứng (KHÔNG cache — mỗi lần gọi mở một
  connection mới, cùng cách ``gateway.deps.get_vfs``; an toàn vì W1 chạy 1 tiến trình
  1 writer; caller không cần ``close()`` — connection được GC cùng instance).
- vòng đời sandbox: start/stop/pause/resume/renew + ghi sổ operations (idempotency
  theo ``request_id``).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.providers.base import SandboxProvider
from sandbox_kit_clone.system.store import SystemStore
from sandbox_kit_clone.vfs.core import VFS
from sandbox_kit_clone.vfs.schema import init_workspace_db

# Image mặc định cho PoC (W2 sẽ thay bằng image thật theo cấu hình).
DEFAULT_SANDBOX_IMAGE = "poc/python-toolchain"

# Số lần thử lại khi workspace_id trùng (xác suất cực hiếm — uuid4().hex[:12]).
_CREATE_WORKSPACE_RETRIES = 3


def _utcnow_iso() -> str:
    """Mốc thời gian chuẩn dùng chung (UTC ISO 8601)."""
    return datetime.now(UTC).isoformat()


class Manager:
    """Điều phối W1: workspace/session/sandbox + ghi sổ system DB."""

    def __init__(self, settings: Settings, provider: SandboxProvider) -> None:
        self.settings = settings
        self.provider = provider
        data_dir = Path(settings.data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        # §6.1: database hệ thống = data/system.sqlite (SystemStore tự init schema).
        self.store = SystemStore(data_dir / "system.sqlite")

    # ------------------------------------------------------------- đường dẫn

    def workspace_db_path(self, workspace_id: str) -> Path:
        """Đường DB dự án — §6.1: ``data/workspaces/{id}.sqlite`` (khớp gateway.deps)."""
        return Path(self.settings.data_dir) / "workspaces" / f"{workspace_id}.sqlite"

    def workspace_dir(self, workspace_id: str) -> Path:
        """Thư mục dữ liệu dự án (sidecar blob + seed volume) — khớp VFS.workspace_dir."""
        return Path(self.settings.data_dir) / "workspaces" / workspace_id

    # ------------------------------------------------------------- workspace

    def create_workspace(self, name: str = "") -> dict:
        """Tạo workspace + session STANDBY; trả ``{workspace_id, session_id, name}``."""
        last_exc: Exception | None = None
        for _ in range(_CREATE_WORKSPACE_RETRIES):
            workspace_id = uuid.uuid4().hex[:12]
            try:
                return self._create_workspace_once(workspace_id, name)
            except AppError as exc:
                if exc.code is not ErrorCode.conflict:
                    raise
                last_exc = exc  # trùng workspace_id cực hiếm — thử id khác
        raise AppError(
            ErrorCode.conflict,
            f"Tạo workspace thất bại sau {_CREATE_WORKSPACE_RETRIES} lần thử (id trùng)",
        ) from last_exc

    def _create_workspace_once(self, workspace_id: str, name: str) -> dict:
        session_id = uuid.uuid4().hex

        def _do() -> dict:
            # init_workspace_db idempotent; trả conn — đóng ngay, VFS mở riêng mỗi lần đọc.
            init_workspace_db(self.workspace_db_path(workspace_id)).close()
            self.store.create_workspace(workspace_id, status="active")
            self.store.create_session(session_id, workspace_id, state="STANDBY")
            return {"workspace_id": workspace_id, "session_id": session_id, "name": name or None}

        return self._op("workspace_create", workspace_id, None, _do)

    def resolve_session(self, session_id: str) -> tuple[str, VFS]:
        """Tra phiên → ``(workspace_id, VFS)``; không có → ``session_not_found``.

        VFS mở mới mỗi lần gọi, KHÔNG cache (connection per-call — xem docstring
        module); caller không bắt buộc ``close()``.
        """
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        workspace_id = session["workspace_id"]
        db_path = self.workspace_db_path(workspace_id)
        init_workspace_db(db_path).close()  # idempotent — đảm bảo schema trước khi mở VFS
        return workspace_id, VFS(db_path, self.settings)

    # --------------------------------------------------------------- sandbox

    def sandbox_start(
        self,
        session_id: str,
        ttl_seconds: int = 3600,
        cpu: int | None = None,
        memory: int | None = None,
    ) -> dict:
        """Chạy sandbox cho phiên STANDBY: seed volume → tạo sandbox → state RUNNING.

        W1: ``prepare_workspace`` seed nguyên thư mục workspace (có dữ liệu thật);
        W3 sẽ thay bằng materialize VFS→volume theo revision.
        """
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        if session["state"] != "STANDBY":
            raise AppError(
                ErrorCode.invalid_request,
                f"session đang {session['state']} — chỉ STANDBY mới start được"
                " (PAUSED dùng sandbox_resume)",
            )
        workspace_id = session["workspace_id"]
        return self._op(
            "sandbox_start",
            workspace_id,
            None,
            lambda: self._do_start(session_id, workspace_id, ttl_seconds, cpu, memory),
        )

    def _do_start(
        self,
        session_id: str,
        workspace_id: str,
        ttl_seconds: int,
        cpu: int | None,
        memory: int | None,
    ) -> dict:
        # W1 seed nguyên thư mục workspace (W3 thay bằng materialize VFS→volume).
        # Thư mục sidecar do VFS tạo — đảm bảo có trước để seed cả khi chưa ghi file nào.
        self.workspace_dir(workspace_id).mkdir(parents=True, exist_ok=True)
        volume = self.provider.prepare_workspace(session_id, str(self.workspace_dir(workspace_id)))
        sandbox_id = self.provider.create_sandbox(
            session_id,
            image=DEFAULT_SANDBOX_IMAGE,
            ttl_seconds=ttl_seconds,
            cpu=cpu,
            memory=memory,
        )
        self.store.set_session_sandbox(session_id, sandbox_id)
        self.store.update_session_state(session_id, "RUNNING")
        expires_at = (
            (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat()
            if ttl_seconds > 0
            else None
        )
        self.store.set_session_expiry(session_id, expires_at)
        # Row sync_state sẵn cho W3 (push/pull cập nhật last_synced_revision về sau).
        self.store.upsert_sync_state(sandbox_id, workspace_id)
        return {
            "sandbox_id": sandbox_id,
            "state": "RUNNING",
            "dial_target": self.provider.get_dial_target(sandbox_id),
            "volume": volume,
        }

    def sandbox_stop(self, session_id: str) -> dict:
        """Hủy sandbox + phiên về STANDBY; phải đang RUNNING/PAUSED."""
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        if session["state"] not in ("RUNNING", "PAUSED"):
            raise AppError(
                ErrorCode.invalid_request,
                f"session đang {session['state']} — chỉ RUNNING/PAUSED mới stop được",
            )
        sandbox_id = session["sandbox_id"]
        return self._op(
            "sandbox_stop",
            session["workspace_id"],
            sandbox_id,
            lambda: self._do_stop(session_id, sandbox_id),
        )

    def _do_stop(self, session_id: str, sandbox_id: str | None) -> dict:
        if sandbox_id:
            self.provider.terminate_sandbox(sandbox_id)
        self.store.update_session_state(session_id, "STANDBY")
        return {"state": "STANDBY"}

    def sandbox_pause(self, session_id: str) -> dict:
        """Tạm dừng sandbox đang RUNNING → phiên PAUSED."""
        return self._map_session(
            session_id, "sandbox_pause", from_states=("RUNNING",), to_state="PAUSED"
        )

    def sandbox_resume(self, session_id: str) -> dict:
        """Tiếp tục sandbox đang PAUSED → phiên RUNNING."""
        return self._map_session(
            session_id, "sandbox_resume", from_states=("PAUSED",), to_state="RUNNING"
        )

    def sandbox_renew(self, session_id: str, ttl_seconds: int) -> dict:
        """Gia hạn thời hạn sống thêm ``ttl_seconds`` giây (phiên RUNNING/PAUSED)."""
        if ttl_seconds <= 0:
            raise AppError(ErrorCode.invalid_request, "ttl_seconds phải lớn hơn 0")
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        if session["state"] not in ("RUNNING", "PAUSED"):
            raise AppError(
                ErrorCode.invalid_request,
                f"session đang {session['state']} — chỉ RUNNING/PAUSED mới renew được",
            )
        return self._op(
            "sandbox_renew",
            session["workspace_id"],
            session["sandbox_id"],
            lambda: self._do_renew(session_id, session["sandbox_id"], ttl_seconds),
        )

    def _do_renew(self, session_id: str, sandbox_id: str | None, ttl_seconds: int) -> dict:
        if sandbox_id:
            self.provider.renew_sandbox(sandbox_id, ttl_seconds)
        # Provider cộng ttl vào hạn cũ; mốc None ("không hết hạn") → tính từ bây giờ.
        current = self._parse_iso(self.store.get_session(session_id)["expires_at"])
        expires_at = (current or datetime.now(UTC)) + timedelta(seconds=ttl_seconds)
        self.store.set_session_expiry(session_id, expires_at.isoformat())
        state = self.store.get_session(session_id)["state"]
        return {"state": state, "expires_at": expires_at.isoformat()}

    def _map_session(self, session_id: str, op_type: str, from_states: tuple[str, ...], to_state: str) -> dict:
        """Map thẳng provider ↔ state phiên: kiểm state → gọi provider → đổi state."""
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        if session["state"] not in from_states:
            raise AppError(
                ErrorCode.invalid_request,
                f"session đang {session['state']} — {op_type} yêu cầu {'/'.join(from_states)}",
            )
        sandbox_id = session["sandbox_id"]
        return self._op(
            op_type,
            session["workspace_id"],
            sandbox_id,
            lambda: self._do_map(session_id, sandbox_id, op_type, to_state),
        )

    def _do_map(self, session_id: str, sandbox_id: str | None, op_type: str, to_state: str) -> dict:
        if sandbox_id:
            provider_fn: dict[str, Callable[[str], None]] = {
                "sandbox_pause": self.provider.pause_sandbox,
                "sandbox_resume": self.provider.resume_sandbox,
            }
            provider_fn[op_type](sandbox_id)
        self.store.update_session_state(session_id, to_state)
        return {"state": to_state}

    def sandbox_status(self, session_id: str) -> dict:
        """Trạng thái phiên + sandbox (provider_state đọc từ provider nếu có)."""
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        sandbox_id = session["sandbox_id"]
        return {
            "session_id": session_id,
            "state": session["state"],
            "workspace_id": session["workspace_id"],
            "sandbox_id": sandbox_id,
            "provider_state": self._provider_state(sandbox_id),
            "expires_at": session["expires_at"],
        }

    def _provider_state(self, sandbox_id: str | None) -> str | None:
        """Trạng thái theo provider; sandbox lạ/hết hoặc provider không hỗ trợ → None."""
        if not sandbox_id:
            return None
        getter = getattr(self.provider, "get_sandbox_state", None)
        if not callable(getter):
            return None
        try:
            return getter(sandbox_id)
        except AppError:
            return None

    # ------------------------------------------------------------------ sync

    def sync_status(self, session_id: str) -> dict:
        """Trạng thái đồng bộ (W3 hoàn thiện): revision hiện tại + mốc sync nếu có."""
        _workspace_id, vfs = self.resolve_session(session_id)
        session = self.store.get_session(session_id)
        sandbox_id = session["sandbox_id"] if session else None
        status = "syncing"
        if sandbox_id:
            sync_row = self.store.get_sync_state(sandbox_id)
            if sync_row is not None:
                status = sync_row["status"]
        return {"workspace_revision": vfs.revision, "status": status, "pending_push": 0}

    # ------------------------------------------------------------- ghi sổ op

    def _op(self, op_type: str, workspace_id: str, sandbox_id: str | None, fn: Callable[[], dict]) -> dict:
        """Ghi sổ operations quanh ``fn``: running → success/failed (idempotency theo request_id)."""
        op_id = uuid.uuid4().hex
        row = self.store.record_operation(
            op_id=op_id,
            request_id=uuid.uuid4().hex,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            type=op_type,
        )
        try:
            result = fn()
        except AppError:
            self.store.finish_operation(row["op_id"], "failed")
            raise
        except Exception:
            self.store.finish_operation(row["op_id"], "failed")
            raise
        self.store.finish_operation(row["op_id"], "success")
        return result

    @staticmethod
    def _parse_iso(value: str | None) -> datetime | None:
        """Parse ISO 8601 an toàn; None/chuỗi rỗng/sai định dạng → None."""
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
