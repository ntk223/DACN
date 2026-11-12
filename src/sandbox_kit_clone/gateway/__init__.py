"""Gateway HTTP (W1.4): upload/download theo phần + error handler + GC staging.

App chính FastAPI (auth, ráp router, mount MCP) là việc của W1.5 — module này chỉ
cung cấp bộ phận: router, handler lỗi, GC staging và các dependency chung.
"""

from sandbox_kit_clone.gateway.deps import (
    StagingSession,
    get_vfs,
    staging_root,
    vfs_not_found_guard,
    workspace_db_path,
    workspace_dir,
)
from sandbox_kit_clone.gateway.gc import gc_staging
from sandbox_kit_clone.gateway.http_error import install_error_handlers
from sandbox_kit_clone.gateway.upload import CHUNK_SIZE, download_router, upload_router

__all__ = [
    "CHUNK_SIZE",
    "StagingSession",
    "download_router",
    "gc_staging",
    "get_vfs",
    "install_error_handlers",
    "staging_root",
    "upload_router",
    "vfs_not_found_guard",
    "workspace_db_path",
    "workspace_dir",
]
