"""Schema database dự án (workspace) — bám đúng ``docs/system-design.md`` §6.2."""

from __future__ import annotations

import sqlite3
from pathlib import Path

# SQL khởi tạo database dự án — giữ nguyên khối SQL của system-design.md §6.2.
# Chỉ thêm `IF NOT EXISTS` để init chạy lại không lỗi, không mất dữ liệu.
WORKSPACE_SCHEMA = """\
PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  workspace_revision INTEGER NOT NULL DEFAULT 0,  -- đếm phiên bản dự án, tăng mỗi lần thay đổi file
  conflict_policy    TEXT NOT NULL DEFAULT 'sandbox_wins'  -- 'sandbox_wins' | 'error'
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  content BLOB,                                   -- NULL khi file lưu rời
  size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  mtime TEXT NOT NULL, is_binary INTEGER NOT NULL DEFAULT 0,
  storage_class TEXT NOT NULL DEFAULT 'vfs',      -- 'vfs' | 'blob' (file rời ≥32MB)
  blob_ref TEXT,                                  -- tên file rời
  rev INTEGER NOT NULL,                           -- phiên bản lúc thay đổi cuối
  synced_sha256 TEXT                              -- "dấu vân tay" bản sao chắc chắn có trong sandbox
);
CREATE INDEX IF NOT EXISTS idx_files_rev ON files(rev);

CREATE TABLE IF NOT EXISTS file_revisions (       -- lịch sử; tối đa 20 bản mỗi file
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL, patch TEXT NOT NULL,
  before_sha TEXT NOT NULL, after_sha TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tombstones (           -- dấu vết file đã xóa, chờ mọi sandbox xác nhận
  path TEXT PRIMARY KEY, rev INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  origin TEXT NOT NULL,                           -- 'vfs' | 'sandbox'
  blob_ref TEXT
);

CREATE TABLE IF NOT EXISTS git_meta (             -- khôi phục từ bản gốc (C6)
  id INTEGER PRIMARY KEY DEFAULT 1,
  head_commit TEXT, branch TEXT NOT NULL DEFAULT 'main', remote_url TEXT
);
"""

_PRAGMAS = (
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA foreign_keys = ON",
    "PRAGMA busy_timeout = 5000",
)


def connect_workspace_db(path: Path) -> sqlite3.Connection:
    """Mở connection tới database dự án: tạo thư mục cha nếu thiếu + bật PRAGMA."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    for pragma in _PRAGMAS:
        conn.execute(pragma)
    conn.row_factory = sqlite3.Row
    return conn


def init_workspace_db(path: Path) -> sqlite3.Connection:
    """Tạo schema + seed row đơn nhất; idempotent (chạy lại không lỗi, không mất dữ liệu)."""
    conn = connect_workspace_db(path)
    conn.executescript(WORKSPACE_SCHEMA)
    conn.execute("INSERT OR IGNORE INTO workspace_meta (id) VALUES (1)")
    conn.execute("INSERT OR IGNORE INTO git_meta (id) VALUES (1)")
    conn.commit()
    return conn
