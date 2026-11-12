"""Dọn dẹp staging upload quá hạn — hàm thuần, KHÔNG chạy nền (scheduled runner để W4)."""

from __future__ import annotations

import shutil
import time

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway.deps import _SESSIONS, _SESSIONS_LOCK, staging_root


def gc_staging(settings: Settings, now: float | None = None) -> list[str]:
    """Quét ``staging/upload``: xóa thư mục token có mtime cũ hơn ``staging_max_age_hours``.

    Trả về danh sách token đã dọn; registry entry tương ứng cũng bị gỡ. Thêm: các phiên
    đã ``completed`` mà thư mục staging không còn (đã dọn khi complete) cũng được gỡ khỏi
    registry để không tích tụ rác metadata.
    """
    now = time.time() if now is None else now
    cutoff = now - float(settings.staging_max_age_hours) * 3600
    root = staging_root(settings)
    removed: list[str] = []
    if not root.is_dir():
        return removed

    with _SESSIONS_LOCK:
        for entry in sorted(root.iterdir()):
            if not entry.is_dir():
                continue
            if entry.stat().st_mtime > cutoff:
                continue
            shutil.rmtree(entry, ignore_errors=True)
            _SESSIONS.pop(entry.name, None)
            removed.append(entry.name)

        stale_completed = [
            token
            for token, session in _SESSIONS.items()
            if session.completed and not (root / token).exists()
        ]
        for token in stale_completed:
            _SESSIONS.pop(token, None)
    return removed
