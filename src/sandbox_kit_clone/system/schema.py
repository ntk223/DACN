"""Schema database hệ thống — bám đúng ``docs/system-design.md`` §6.3."""

from __future__ import annotations

import sqlite3
from pathlib import Path

# SQL khởi tạo database hệ thống — giữ nguyên khối SQL của system-design.md §6.3.
# Chỉ thêm `IF NOT EXISTS` để init chạy lại không lỗi, không mất dữ liệu. Không seed row nào.
SYSTEM_SCHEMA = """\
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  sandbox_id TEXT, state TEXT NOT NULL,            -- STANDBY|STARTING|RUNNING|PAUSED
  expires_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  sandbox_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  last_synced_revision INTEGER NOT NULL DEFAULT 0, -- mốc đồng bộ
  status TEXT NOT NULL DEFAULT 'syncing',          -- syncing | synced | stale
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (            -- sổ thao tác
  op_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,                 -- mã định danh — chạy lại không làm đôi
  workspace_id TEXT NOT NULL, sandbox_id TEXT,
  type TEXT NOT NULL, status TEXT NOT NULL,        -- running | success | failed
  result_digest TEXT, created_at TEXT NOT NULL
);
"""

_PRAGMAS = (
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA foreign_keys = ON",
    "PRAGMA busy_timeout = 5000",
)


def connect_system_db(path: Path) -> sqlite3.Connection:
    """Mở connection tới database hệ thống: tạo thư mục cha nếu thiếu + bật PRAGMA."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    for pragma in _PRAGMAS:
        conn.execute(pragma)
    conn.row_factory = sqlite3.Row
    return conn


def init_system_db(path: Path) -> sqlite3.Connection:
    """Tạo schema database hệ thống; idempotent; KHÔNG seed row nào."""
    conn = connect_system_db(path)
    conn.executescript(SYSTEM_SCHEMA)
    conn.commit()
    return conn
