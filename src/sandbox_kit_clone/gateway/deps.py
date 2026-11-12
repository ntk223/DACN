"""Phụ thuộc dùng chung cho gateway: registry phiên upload, bố trí đĩa, mở VFS.

Ghi chú PoC:
- Registry phiên upload (``_SESSIONS``) chỉ giữ metadata trong bộ nhớ; dữ liệu chunk nằm
  trên đĩa (``staging/upload/{token}/``). Tiến trình khởi động lại → registry mất, các
  thư mục staging mồ côi do ``gc_staging`` dọn theo tuổi — chấp nhận cho PoC.
- ``get_vfs`` KHÔNG cache: mỗi lần gọi mở một VFS/connection mới. An toàn vì W1 chạy
  1 tiến trình, 1 writer (W3 sync chưa vào); khi đa tiến trình (W4) cần xem lại điểm này.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from sandbox_kit_clone.config import Settings, get_settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.vfs.core import VFS
from sandbox_kit_clone.vfs.schema import init_workspace_db


@dataclass
class StagingSession:
    """Metadata một phiên upload theo phần; dữ liệu chunk ở ``staging/upload/{token}/``."""

    token: str
    workspace_id: str
    path: str                       # đường đích trong VFS — client khai báo khi init
    declared_size: int
    expected_sha256: str | None = None
    created_at: float = field(default_factory=time.time)
    chunk_count: int = 0            # = max(index đã nhận) + 1
    completed: bool = False


# Registry in-memory (chỉ metadata — xem docstring module về giới hạn PoC).
_SESSIONS: dict[str, StagingSession] = {}
_SESSIONS_LOCK = threading.Lock()


def staging_root(settings: Settings) -> Path:
    """Gốc chứa tạm upload — §6.1: ``data/staging/upload/{token}/``."""
    return Path(settings.data_dir) / "staging" / "upload"


def workspace_dir(workspace_id: str, settings: Settings) -> Path:
    """Gốc chứa các workspace — DB là ``{id}.sqlite`` (§6.1).

    Lưu ý: vị trí blob rời do VFS sở hữu (``VFS.blobs`` =
    ``db.parent/{id}/blobs/`` theo §6.1), route gateway luôn đi qua
    ``vfs.blobs`` nên không phụ thuộc layout cụ thể của sidecar.
    """
    return Path(settings.data_dir) / "workspaces"


def workspace_db_path(workspace_id: str, settings: Settings) -> Path:
    """Đường database dự án — §6.1: ``data/workspaces/{id}.sqlite``."""
    _safe_workspace_id(workspace_id)
    return workspace_dir(workspace_id, settings) / f"{workspace_id}.sqlite"


def _safe_workspace_id(workspace_id: str) -> str:
    """Chặn workspace_id chứa ký tự ghép đường dẫn → tràn ra ngoài thư mục workspaces."""
    if not workspace_id or "/" in workspace_id or "\\" in workspace_id or ".." in workspace_id:
        raise AppError(
            ErrorCode.invalid_request, f"workspace_id không hợp lệ: {workspace_id!r}"
        )
    return workspace_id


def get_vfs(workspace_id: str, settings: Settings) -> VFS:
    """Mở VFS cho workspace (KHÔNG cache — mỗi call một connection mới, xem docstring module)."""
    db_path = workspace_db_path(workspace_id, settings)
    init_workspace_db(db_path).close()  # idempotent — đảm bảo schema có trước khi VFS mở
    return VFS(db_path, settings)


def vfs_not_found_guard(workspace_id: str, settings: Settings | None = None) -> None:
    """Raise ``workspace_not_found`` nếu DB của workspace chưa tồn tại trên đĩa."""
    if settings is None:
        settings = get_settings()
    if not workspace_db_path(workspace_id, settings).is_file():
        raise AppError(
            ErrorCode.workspace_not_found, f"Workspace '{workspace_id}' không tồn tại"
        )
