"""Kiểm thử W1.1: schema database dự án + database hệ thống (SystemStore)."""

from __future__ import annotations

import pytest

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.system.store import SystemStore
from sandbox_kit_clone.vfs.schema import init_workspace_db

WORKSPACE_TABLES = {"workspace_meta", "files", "file_revisions", "tombstones", "git_meta"}


def test_workspace_db_init_idempotent(tmp_path):
    db_path = tmp_path / "workspaces" / "ws.sqlite"
    conn = init_workspace_db(db_path)

    # Chèn dữ liệu giữa 2 lần init — phải còn nguyên sau lần init thứ hai.
    conn.execute(
        "INSERT INTO files (path, content, size, sha256, mtime, rev)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        ("a.txt", b"hello", 5, "sha256:abc", "2026-01-01T00:00:00+00:00", 1),
    )
    conn.commit()

    conn2 = init_workspace_db(db_path)
    try:
        tables = {
            row["name"]
            for row in conn2.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert WORKSPACE_TABLES <= tables

        meta_rows = conn2.execute("SELECT * FROM workspace_meta").fetchall()
        assert len(meta_rows) == 1
        assert meta_rows[0]["id"] == 1
        assert meta_rows[0]["workspace_revision"] == 0
        assert meta_rows[0]["conflict_policy"] == "sandbox_wins"

        git_rows = conn2.execute("SELECT * FROM git_meta").fetchall()
        assert len(git_rows) == 1
        assert git_rows[0]["branch"] == "main"

        # Dữ liệu chèn giữa 2 lần init còn nguyên.
        row = conn2.execute("SELECT sha256, size FROM files WHERE path = 'a.txt'").fetchone()
        assert row is not None
        assert row["sha256"] == "sha256:abc"
        assert row["size"] == 5
    finally:
        conn.close()
        conn2.close()


def test_workspace_db_pragmas(tmp_path):
    conn = init_workspace_db(tmp_path / "ws.sqlite")
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()


def test_system_store_workspace_crud(tmp_path):
    store = SystemStore(tmp_path / "system.sqlite")
    try:
        store.create_workspace("ws-1")
        ws = store.get_workspace("ws-1")
        assert ws is not None
        assert ws["id"] == "ws-1"
        assert ws["status"] == "active"
        assert ws["created_at"]

        store.create_workspace("ws-2", status="archived")
        assert {w["id"] for w in store.list_workspaces()} == {"ws-1", "ws-2"}

        with pytest.raises(AppError) as exc_info:
            store.create_workspace("ws-1")
        assert exc_info.value.code is ErrorCode.conflict

        assert store.get_workspace("missing") is None
    finally:
        store.close()


def test_system_store_session_fk(tmp_path):
    store = SystemStore(tmp_path / "system.sqlite")
    try:
        # Workspace chưa tồn tại → FK chặn → AppError workspace_not_found.
        with pytest.raises(AppError) as exc_info:
            store.create_session("s-1", "missing-ws")
        assert exc_info.value.code is ErrorCode.workspace_not_found

        store.create_workspace("ws-1")
        store.create_session("s-1", "ws-1")

        session = store.get_session("s-1")
        assert session is not None
        assert session["session_id"] == "s-1"
        assert session["workspace_id"] == "ws-1"
        assert session["state"] == "STANDBY"
        assert session["sandbox_id"] is None
        assert session["expires_at"] is None
        assert session["created_at"]

        store.update_session_state("s-1", "RUNNING")
        store.set_session_sandbox("s-1", "sbx-1")
        store.set_session_expiry("s-1", "2026-12-31T00:00:00+00:00")
        session = store.get_session("s-1")
        assert session["state"] == "RUNNING"
        assert session["sandbox_id"] == "sbx-1"
        assert session["expires_at"] == "2026-12-31T00:00:00+00:00"

        # Đặt lại expiry về NULL.
        store.set_session_expiry("s-1", None)
        assert store.get_session("s-1")["expires_at"] is None
    finally:
        store.close()


def test_system_store_sync_state(tmp_path):
    store = SystemStore(tmp_path / "system.sqlite")
    try:
        # Lần đầu: insert mới, status lấy default 'syncing'.
        store.upsert_sync_state("sbx-1", "ws-1", last_synced_revision=5)
        state = store.get_sync_state("sbx-1")
        assert state is not None
        assert state["sandbox_id"] == "sbx-1"
        assert state["workspace_id"] == "ws-1"
        assert state["last_synced_revision"] == 5
        assert state["status"] == "syncing"
        assert state["updated_at"]

        # Lần sau: chỉ update revision — status giữ nguyên.
        store.upsert_sync_state("sbx-1", "ws-1", last_synced_revision=9)
        state = store.get_sync_state("sbx-1")
        assert state["last_synced_revision"] == 9
        assert state["status"] == "syncing"

        # Chỉ update status — revision giữ nguyên.
        store.upsert_sync_state("sbx-1", "ws-1", status="synced")
        state = store.get_sync_state("sbx-1")
        assert state["status"] == "synced"
        assert state["last_synced_revision"] == 9

        assert store.get_sync_state("missing") is None
    finally:
        store.close()


def test_operations_idempotent(tmp_path):
    store = SystemStore(tmp_path / "system.sqlite")
    try:
        first = store.record_operation("op-1", "req-1", "ws-1", None, "pull")
        assert first["op_id"] == "op-1"
        assert first["request_id"] == "req-1"
        assert first["status"] == "running"
        assert first["created_at"]

        # Trùng request_id (op_id khác) → trả row cũ, KHÔNG tạo row 2.
        second = store.record_operation("op-2", "req-1", "ws-1", None, "pull")
        assert second["op_id"] == "op-1"
        assert second["created_at"] == first["created_at"]

        # older_than_seconds=0 → mọi operation running hiện có được trả về.
        stale = store.list_stale_running(older_than_seconds=0)
        assert len(stale) == 1
        assert stale[0]["op_id"] == "op-1"

        store.finish_operation("op-1", "success", result_digest="digest:abc")
        assert store.list_stale_running(older_than_seconds=0) == []
    finally:
        store.close()
