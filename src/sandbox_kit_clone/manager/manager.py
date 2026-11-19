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

import shutil
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.manager.exec_client import ExecClientPool
from sandbox_kit_clone.providers.base import SandboxProvider
from sandbox_kit_clone.system.store import SystemStore
from sandbox_kit_clone.vfs.core import VFS
from sandbox_kit_clone.vfs.schema import (
    DEFAULT_CONFLICT_POLICY,
    init_workspace_db,
    validate_conflict_policy,
)

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
        self.exec_clients = ExecClientPool()

    # ------------------------------------------------------------- đường dẫn

    def workspace_db_path(self, workspace_id: str) -> Path:
        """Đường DB dự án — §6.1: ``data/workspaces/{id}.sqlite`` (khớp gateway.deps)."""
        return Path(self.settings.data_dir) / "workspaces" / f"{workspace_id}.sqlite"

    def workspace_dir(self, workspace_id: str) -> Path:
        """Thư mục dữ liệu dự án (sidecar blob + seed volume) — khớp VFS.workspace_dir."""
        return Path(self.settings.data_dir) / "workspaces" / workspace_id

    # ------------------------------------------------------------- workspace

    def create_workspace(
        self, name: str = "", conflict_policy: str = DEFAULT_CONFLICT_POLICY
    ) -> dict:
        """Tạo workspace + session STANDBY; trả ``{workspace_id, session_id, name, conflict_policy, created_at}``.

        ``conflict_policy`` kiểm qua ``validate_conflict_policy`` (một điểm duy nhất —
        thêm chính sách mới không phải sửa Manager); lỗi đầu vào KHÔNG ghi sổ operations.
        """
        # Validate TRƯỚC khi ghi sổ: request sai định dạng không tạo dòng sổ rác.
        policy = validate_conflict_policy(conflict_policy)
        last_exc: Exception | None = None
        for _ in range(_CREATE_WORKSPACE_RETRIES):
            workspace_id = uuid.uuid4().hex[:12]
            try:
                return self._create_workspace_once(workspace_id, name, policy)
            except AppError as exc:
                if exc.code is not ErrorCode.conflict:
                    raise
                last_exc = exc  # trùng workspace_id cực hiếm — thử id khác
        raise AppError(
            ErrorCode.conflict,
            f"Tạo workspace thất bại sau {_CREATE_WORKSPACE_RETRIES} lần thử (id trùng)",
        ) from last_exc

    def _create_workspace_once(self, workspace_id: str, name: str, policy: str) -> dict:
        session_id = uuid.uuid4().hex

        def _do() -> dict:
            # init_workspace_db idempotent; trả conn — ghi chính sách vào workspace_meta
            # (đúng seed của thiết kế) rồi đóng; VFS mở riêng mỗi lần đọc.
            conn = init_workspace_db(self.workspace_db_path(workspace_id))
            conn.execute(
                "UPDATE workspace_meta SET conflict_policy = ? WHERE id = 1", (policy,)
            )
            conn.commit()
            conn.close()
            self.store.create_workspace(workspace_id, status="active")
            self.store.create_session(session_id, workspace_id, state="STANDBY")
            return {
                "workspace_id": workspace_id,
                "session_id": session_id,
                "name": name or None,
                "conflict_policy": policy,
                "created_at": _utcnow_iso(),
            }

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
        # §7.1 / design-01 §6.1: xuất file từ VFS ra thư mục tạm → provider chép vào volume
        # (không đi qua kênh đồng bộ) → đánh dấu synced_sha256 + mốc đồng bộ.
        staging, exported, revision = self._export_workspace(session_id, workspace_id)
        try:
            volume = self.provider.prepare_workspace(session_id, str(staging))
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        try:
            sandbox_id = self.provider.create_sandbox(
                session_id,
                image=self.settings.sandbox_image,
                ttl_seconds=ttl_seconds,
                cpu=cpu,
                memory=memory,
            )
        except Exception:
            cleanup = getattr(self.provider, "cleanup_workspace", None)
            if callable(cleanup):
                cleanup(session_id)
            raise
        _ws, vfs = self.resolve_session(session_id)
        try:
            for path, sha in exported:
                vfs.set_synced_sha(path, sha)
        finally:
            vfs.close()
        self.store.set_session_sandbox(session_id, sandbox_id)
        self.store.update_session_state(session_id, "RUNNING")
        expires_at = (
            (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat()
            if ttl_seconds > 0
            else None
        )
        self.store.set_session_expiry(session_id, expires_at)
        self.store.upsert_sync_state(
            sandbox_id, workspace_id, last_synced_revision=revision, status="synced"
        )
        return {
            "sandbox_id": sandbox_id,
            "state": "RUNNING",
            "dial_target": self.provider.get_dial_target(sandbox_id),
            "volume": volume,
            "materialized_files": len(exported),
            "synced_revision": revision,
        }

    def _export_workspace(self, session_id: str, workspace_id: str) -> tuple[Path, list[tuple[str, str]], int]:
        """Ghi toàn bộ file hiện có của VFS ra ``data/materialize/{session}/``.

        Trả ``(thư mục, [(path, sha256)], revision)``. File rời (blob) chép thẳng từ
        sidecar, không nạp vào bộ nhớ.
        """
        staging = Path(self.settings.data_dir) / "materialize" / session_id
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        _ws, vfs = self.resolve_session(session_id)
        exported: list[tuple[str, str]] = []
        try:
            revision = vfs.revision
            for item in vfs.list_files():
                info = vfs.get_file_info(item["path"])
                if info is None:
                    continue
                target = staging / info["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                if info["storage_class"] == "blob" and info["blob_ref"]:
                    shutil.copyfile(vfs.blobs.path_of(info["blob_ref"]), target)
                else:
                    target.write_bytes(vfs.read_file(info["path"]))
                exported.append((info["path"], info["sha256"]))
        finally:
            vfs.close()
        return staging, exported, revision

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
            self.exec_clients.drop(sandbox_id)
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

    # -------------------------------------------------------------- lệnh

    def command_run(
        self,
        session_id: str,
        command: str,
        cwd: str = "",
        env: dict[str, str] | None = None,
        timeout_seconds: int | None = None,
        on_output: Callable[[str, bytes], None] | None = None,
    ) -> dict:
        """Chạy lệnh shell trong sandbox của phiên (phải RUNNING); trả kết quả chuẩn hóa.

        ``on_output(stream, data)`` được gọi ngay khi có output (để gửi dần cho agent).
        W2: CHƯA đẩy thay đổi VFS → sandbox trước lệnh — sandbox chỉ có file tại lúc bật.
        """
        if not command or not command.strip():
            raise AppError(ErrorCode.invalid_request, "command không được rỗng")
        timeout = timeout_seconds or self.settings.command_timeout_default
        if timeout <= 0 or timeout > self.settings.command_timeout_max:
            raise AppError(
                ErrorCode.invalid_request,
                f"timeout_seconds phải trong 1..{self.settings.command_timeout_max}",
            )
        session = self.store.get_session(session_id)
        if session is None:
            raise AppError(ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}")
        if session["state"] != "RUNNING":
            hint = "sandbox_resume" if session["state"] == "PAUSED" else "sandbox_start"
            raise AppError(
                ErrorCode.invalid_request,
                f"session đang {session['state']} — cần RUNNING để chạy lệnh (gọi {hint} trước)",
            )
        sandbox_id = session["sandbox_id"]
        has_agent = getattr(self.provider, "has_exec_agent", None)
        if not sandbox_id or (callable(has_agent) and not has_agent(sandbox_id)):
            raise AppError(
                ErrorCode.capability_unavailable,
                "Sandbox này không có trình thực thi (fake chưa bật SANDBOX_KIT_FAKE_EXEC_HOST,"
                " hoặc container Docker không có mạng)",
                details={"capability": "exec", "provider": getattr(self.provider, "name", "?")},
            )
        target = self.provider.get_dial_target(sandbox_id)
        client = self.exec_clients.get(sandbox_id, target)

        def _do() -> dict:
            client.wait_ready(timeout=self.settings.agent_ready_timeout)
            result = client.run(
                command,
                cwd=cwd,
                env=env,
                timeout_seconds=timeout,
                request_id=uuid.uuid4().hex,
                on_output=on_output,
                max_output_bytes=self.settings.command_output_max_bytes,
            )
            out = {
                "exit_code": result.exit_code,
                "timed_out": result.timed_out,
                "duration_ms": result.duration_ms,
                "stdout": result.stdout.decode("utf-8", "replace"),
                "stderr": result.stderr.decode("utf-8", "replace"),
                "stdout_bytes": result.stdout_bytes,
                "stderr_bytes": result.stderr_bytes,
                "truncated": result.truncated,
                "sandbox_id": sandbox_id,
                "sync": {
                    "pushed": False,
                    "note": "Chưa đồng bộ VFS → sandbox trước lệnh (làm sau): sandbox chỉ có file tại lúc bật.",
                },
            }
            if result.error:
                out["error_detail"] = result.error
            return out

        return self._op("command_run", session["workspace_id"], sandbox_id, _do)

    # ------------------------------------------------------ quản trị sandbox

    def sandbox_overview(self) -> dict:
        """Ghép phiên (system DB) với sandbox thật (provider) cho trang quản trị.

        - ``sessions``: mọi phiên + trạng thái theo provider; ``drift`` = state ghi sổ lệch thực tế.
        - ``orphans``: sandbox provider còn giữ nhưng không phiên nào trỏ tới (ứng viên dọn).
        """
        live = set(self.provider.list_sandboxes())
        sessions = []
        referenced: set[str] = set()
        for row in self.store.list_sessions():
            sandbox_id = row["sandbox_id"]
            active = row["state"] in ("RUNNING", "PAUSED", "STARTING")
            if sandbox_id and active:
                referenced.add(sandbox_id)
            provider_state = self._provider_state(sandbox_id) if sandbox_id in live else None
            sessions.append(
                {
                    **row,
                    "provider_state": provider_state,
                    "drift": _state_drift(row["state"], provider_state),
                }
            )
        orphans = []
        for sandbox_id in sorted(live - referenced):
            try:
                orphans.append(self.provider.describe_sandbox(sandbox_id))
            except (AppError, AttributeError):
                orphans.append({"sandbox_id": sandbox_id})
        return {
            "provider": getattr(self.provider, "name", type(self.provider).__name__),
            "capabilities": getattr(self.provider, "capabilities", {}),
            "image": self.settings.sandbox_image,
            "sessions": sessions,
            "orphans": orphans,
        }

    def sandbox_detail(self, sandbox_id: str) -> dict:
        """Mô tả + số liệu + danh sách file /workspace của một sandbox (tính năng nào thiếu → bỏ qua)."""
        if sandbox_id not in self.provider.list_sandboxes():
            raise AppError(ErrorCode.invalid_request, f"Sandbox không tồn tại hoặc đã bị hủy: {sandbox_id}")
        out: dict = {"sandbox_id": sandbox_id}
        for key, method in (
            ("info", "describe_sandbox"),
            ("metrics", "get_sandbox_metrics"),
            ("workspace", "list_workspace_files"),
        ):
            fn = getattr(self.provider, method, None)
            if not callable(fn):
                continue
            try:
                out[key] = fn(sandbox_id)
            except NotImplementedError:
                continue
            except AppError as exc:
                out[key] = {"error": exc.to_payload()["error"]}
        return out

    def terminate_orphan(self, sandbox_id: str) -> dict:
        """Dọn sandbox mồ côi. Sandbox còn phiên đang dùng → từ chối (dùng sandbox_stop)."""
        for row in self.store.list_sessions():
            if row["sandbox_id"] == sandbox_id and row["state"] in ("RUNNING", "PAUSED", "STARTING"):
                raise AppError(
                    ErrorCode.conflict,
                    f"Sandbox {sandbox_id} đang thuộc phiên {row['session_id']} — dùng sandbox_stop",
                )
        workspace_id = ""
        for row in self.store.list_sessions():
            if row["sandbox_id"] == sandbox_id:
                workspace_id = row["workspace_id"]
        return self._op(
            "sandbox_orphan_cleanup",
            workspace_id,
            sandbox_id,
            lambda: (
                self.exec_clients.drop(sandbox_id),
                self.provider.terminate_sandbox(sandbox_id),
                {"terminated": sandbox_id},
            )[2],
        )

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


def _state_drift(session_state: str, provider_state: str | None) -> bool:
    """Sổ ghi phiên RUNNING/PAUSED nhưng provider báo khác (hoặc mất sandbox) → lệch."""
    expected = {"RUNNING": "running", "PAUSED": "paused"}.get(session_state)
    if expected is None:
        return False
    return provider_state != expected
