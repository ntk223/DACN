"""Hạn mức dung lượng mỗi workspace (C1): từ chối có kiểm soát khi vượt quota."""

from __future__ import annotations

import sqlite3

from sandbox_kit_clone.errors import AppError, ErrorCode


def used_bytes(conn: sqlite3.Connection) -> int:
    """Tổng dung lượng đang lưu trong workspace (SUM(size) bảng files).

    PoC đơn giản: blob của file đã xóa (tombstone) chưa được trừ vào — số liệu
    có thể cao hơn thực tế cho tới khi GC blob chạy (W3+).
    """
    row = conn.execute("SELECT COALESCE(SUM(size), 0) FROM files").fetchone()
    return int(row[0])


def check_quota(used: int, incoming: int, quota_bytes: int) -> None:
    """Chặn ghi khi ``used + incoming`` vượt ``quota_bytes``.

    Vượt → ``AppError(quota_exceeded)`` kèm ``details`` dùng/incoming/quota để
    gateway trả payload chuẩn.
    """
    if used + incoming > quota_bytes:
        raise AppError(
            ErrorCode.quota_exceeded,
            f"Vượt hạn mức workspace: đang dùng {used} bytes + incoming {incoming}"
            f" bytes > quota {quota_bytes} bytes",
            details={"used": used, "incoming": incoming, "quota": quota_bytes},
        )
