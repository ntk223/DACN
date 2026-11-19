"""SystemStore: thao tác trên database hệ thống, thread-safe (một Lock quanh mỗi method)."""

from __future__ import annotations

import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.system.schema import init_system_db


def _utcnow_iso() -> str:
    """Mốc thời gian chuẩn dùng chung (UTC ISO 8601) — so sánh trực tiếp bằng chuỗi."""
    return datetime.now(UTC).isoformat()


class SystemStore:
    """Sở hữu connection system DB; mọi method chạy dưới ``threading.Lock``."""

    def __init__(self, db_path: Path | str) -> None:
        self._conn = init_system_db(Path(db_path))
        self._lock = threading.Lock()

    def close(self) -> None:
        """Đóng connection (teardown test / shutdown)."""
        with self._lock:
            self._conn.close()

    # --------------------------------------------------------------- workspaces

    def create_workspace(self, workspace_id: str, status: str = "active") -> None:
        with self._lock:
            try:
                self._conn.execute(
                    "INSERT INTO workspaces (id, status, created_at) VALUES (?, ?, ?)",
                    (workspace_id, status, _utcnow_iso()),
                )
                self._conn.commit()
            except sqlite3.IntegrityError as exc:
                self._conn.rollback()
                raise AppError(
                    ErrorCode.conflict, f"Workspace đã tồn tại: {workspace_id!r}"
                ) from exc

    def get_workspace(self, workspace_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM workspaces WHERE id = ?", (workspace_id,)
            ).fetchone()
        return dict(row) if row is not None else None

    def list_workspaces(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM workspaces ORDER BY created_at, id"
            ).fetchall()
        return [dict(row) for row in rows]

    # --------------------------------------------------------------- sessions

    def create_session(
        self,
        session_id: str,
        workspace_id: str,
        state: str = "STANDBY",
        sandbox_id: str | None = None,
        expires_at: str | None = None,
    ) -> None:
        """FK đang bật: workspace phải tồn tại, ngược lại → AppError workspace_not_found."""
        with self._lock:
            try:
                self._conn.execute(
                    "INSERT INTO sessions"
                    " (session_id, workspace_id, sandbox_id, state, expires_at, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (session_id, workspace_id, sandbox_id, state, expires_at, _utcnow_iso()),
                )
                self._conn.commit()
            except sqlite3.IntegrityError as exc:
                self._conn.rollback()
                if "FOREIGN KEY" in str(exc):
                    raise AppError(
                        ErrorCode.workspace_not_found,
                        f"Workspace không tồn tại: {workspace_id!r}",
                    ) from exc
                raise AppError(
                    ErrorCode.conflict, f"Session đã tồn tại: {session_id!r}"
                ) from exc

    def get_session(self, session_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        return dict(row) if row is not None else None

    def list_sessions(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM sessions ORDER BY created_at, session_id"
            ).fetchall()
        return [dict(row) for row in rows]

    def update_session_state(self, session_id: str, state: str) -> None:
        self._update_session_row(session_id, "state", state)

    def set_session_sandbox(self, session_id: str, sandbox_id: str | None) -> None:
        self._update_session_row(session_id, "sandbox_id", sandbox_id)

    def set_session_expiry(self, session_id: str, expires_at: str | None) -> None:
        self._update_session_row(session_id, "expires_at", expires_at)

    def _update_session_row(self, session_id: str, column: str, value: object) -> None:
        # `column` chỉ nhận giá trị hằng từ các method ở trên, không phải input người dùng.
        with self._lock:
            cursor = self._conn.execute(
                f"UPDATE sessions SET {column} = ? WHERE session_id = ?",
                (value, session_id),
            )
            if cursor.rowcount == 0:
                self._conn.rollback()
                raise AppError(
                    ErrorCode.session_not_found, f"Session không tồn tại: {session_id!r}"
                )
            self._conn.commit()

    # --------------------------------------------------------------- sync_state

    def upsert_sync_state(
        self,
        sandbox_id: str,
        workspace_id: str,
        last_synced_revision: int | None = None,
        status: str | None = None,
    ) -> None:
        """Insert khi chưa có row; khi đã có, chỉ set các field được truyền vào."""
        with self._lock:
            row = self._conn.execute(
                "SELECT sandbox_id FROM sync_state WHERE sandbox_id = ?", (sandbox_id,)
            ).fetchone()
            if row is None:
                self._conn.execute(
                    "INSERT INTO sync_state"
                    " (sandbox_id, workspace_id, last_synced_revision, status, updated_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (
                        sandbox_id,
                        workspace_id,
                        0 if last_synced_revision is None else last_synced_revision,
                        "syncing" if status is None else status,
                        _utcnow_iso(),
                    ),
                )
            else:
                assignments = ["updated_at = ?"]
                params: list[object] = [_utcnow_iso()]
                if last_synced_revision is not None:
                    assignments.append("last_synced_revision = ?")
                    params.append(last_synced_revision)
                if status is not None:
                    assignments.append("status = ?")
                    params.append(status)
                params.append(sandbox_id)
                self._conn.execute(
                    f"UPDATE sync_state SET {', '.join(assignments)} WHERE sandbox_id = ?",
                    params,
                )
            self._conn.commit()

    def get_sync_state(self, sandbox_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM sync_state WHERE sandbox_id = ?", (sandbox_id,)
            ).fetchone()
        return dict(row) if row is not None else None

    # --------------------------------------------------------------- operations

    def record_operation(
        self,
        op_id: str,
        request_id: str,
        workspace_id: str,
        sandbox_id: str | None,
        type: str,
        status: str = "running",
    ) -> dict:
        """Ghi thao tác; trùng ``request_id`` → trả row cũ (idempotency, không tạo row 2)."""
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO operations"
                " (op_id, request_id, workspace_id, sandbox_id, type, status,"
                "  result_digest, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
                (op_id, request_id, workspace_id, sandbox_id, type, status, _utcnow_iso()),
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM operations WHERE request_id = ?", (request_id,)
            ).fetchone()
        if row is None:
            # Chỉ xảy ra khi op_id trùng PK nhưng request_id khác — xung đột thật.
            raise AppError(
                ErrorCode.conflict, f"op_id đã tồn tại với request_id khác: {op_id!r}"
            )
        return dict(row)

    def finish_operation(
        self, op_id: str, status: str, result_digest: str | None = None
    ) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE operations SET status = ?, result_digest = ? WHERE op_id = ?",
                (status, result_digest, op_id),
            )
            self._conn.commit()

    def list_stale_running(self, older_than_seconds: int) -> list[dict]:
        """Operations status='running' có created_at cũ hơn ngưỡng (so sánh ISO trực tiếp)."""
        cutoff = (datetime.now(UTC) - timedelta(seconds=older_than_seconds)).isoformat()
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM operations WHERE status = 'running' AND created_at < ?"
                " ORDER BY created_at, op_id",
                (cutoff,),
            ).fetchall()
        return [dict(row) for row in rows]
