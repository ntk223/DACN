"""Upload theo phần (chunked) + download stream — tách file lớn khỏi kênh MCP JSON.

Tham chiếu ``docs/system-design.md`` §4 ("File lớn"), §6.1 (bố trí đĩa), §6.4 (file rời
+ hạn mức). Dữ liệu lớn KHÔNG giữ trong RAM: ghi chunk ra đĩa, ghép/hash bằng generator,
download stream theo lượt 1MB. App chính (auth + ráp router) là việc của W1.5.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import uuid
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sandbox_kit_clone.config import Settings, get_settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.gateway.deps import (
    _SESSIONS,
    _SESSIONS_LOCK,
    StagingSession,
    get_vfs,
    staging_root,
    vfs_not_found_guard,
    workspace_db_path,
)
from sandbox_kit_clone.vfs.quota import check_quota, used_bytes
from sandbox_kit_clone.vfs.schema import connect_workspace_db

# Kích thước chunk khuyến nghị cho client (Settings chưa có field riêng → dùng const).
CHUNK_SIZE = 4 * 1024 * 1024  # 4MB
_STREAM_READ_SIZE = 1024 * 1024  # đọc/stream 1MB mỗi lượt — không giữ cả file trong RAM

upload_router = APIRouter(prefix="/upload", tags=["files"])
download_router = APIRouter(tags=["files"])


class UploadInit(BaseModel):
    """Body JSON của ``POST /upload`` — khai báo đích đến + kích thước + sha mong đợi."""

    workspace_id: str
    path: str
    size: int
    sha256: str | None = None


# ------------------------------------------------------------------- helpers


def _settings_of(request: Request) -> Settings:
    """Ưu tiên ``app.state.settings`` (app chính của W1.5 gắn vào); fallback cấu hình env."""
    settings = getattr(request.app.state, "settings", None)
    if isinstance(settings, Settings):
        return settings
    return get_settings()


def _not_found(message: str) -> AppError:
    """Token lạ / phiên đã hoàn tất → 404 (ghi đè status qua details, xem http_error.py)."""
    return AppError(ErrorCode.invalid_request, message, details={"http_status": 404})


def _get_session(token: str, *, allow_completed: bool = False) -> StagingSession:
    """Tra registry; thiếu hoặc đã hoàn tất (khi không cho phép) → 404 invalid_request."""
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(token)
    if session is None or (session.completed and not allow_completed):
        raise _not_found("Phiên upload không tồn tại hoặc đã hoàn tất")
    return session


def _chunk_files(staging_dir: Path) -> list[Path]:
    """Các file chunk theo thứ tự index (tên 6 chữ số → thứ tự từ điển = thứ tự số)."""
    if not staging_dir.is_dir():
        return []
    return sorted(staging_dir.glob("*.chunk"))


def _iter_chunk_bytes(paths: list[Path], read_size: int = _STREAM_READ_SIZE) -> Iterator[bytes]:
    """Đọc tuần tự các file chunk theo lượt nhỏ — không giữ cả file trong RAM."""
    for chunk_path in paths:
        with chunk_path.open("rb") as fp:
            while True:
                block = fp.read(read_size)
                if not block:
                    break
                yield block


def _extract_rev(result: object) -> int | None:
    """Lấy revision từ dict trả về của ``write_file``/``import_blob`` (khóa ``rev``)."""
    if isinstance(result, dict):
        value = result.get("rev")
        return value if isinstance(value, int) else None
    return None


# -------------------------------------------------------------------- upload


@upload_router.post("")
def init_upload(payload: UploadInit, request: Request) -> dict:
    """Khai báo phiên upload: kiểm tra workspace + hạn mức → cấp token + thư mục staging."""
    settings = _settings_of(request)
    vfs_not_found_guard(payload.workspace_id, settings)
    if payload.size <= 0:
        raise AppError(ErrorCode.invalid_request, "size phải lớn hơn 0")

    # Hạn mức §6.4: kiểm tra ở điểm nạp đầu tiên (used hiện tại + size khai báo).
    db_path = workspace_db_path(payload.workspace_id, settings)
    conn = connect_workspace_db(db_path)
    try:
        check_quota(used_bytes(conn), payload.size, settings.workspace_quota_bytes)
    finally:
        conn.close()

    # Canonicalize sớm: sai đường dẫn → chặn trước khi client mất công truyền file.
    from sandbox_kit_clone.vfs.ignore import ensure_storable
    from sandbox_kit_clone.vfs.paths import canonicalize_path

    path = canonicalize_path(payload.path)
    ensure_storable(path)  # thư viện / build → chặn trước khi client truyền dữ liệu

    token = uuid.uuid4().hex
    staging_root(settings).joinpath(token).mkdir(parents=True, exist_ok=False)
    session = StagingSession(
        token=token,
        workspace_id=payload.workspace_id,
        path=path,
        declared_size=payload.size,
        expected_sha256=payload.sha256,
    )
    with _SESSIONS_LOCK:
        _SESSIONS[token] = session
    return {
        "token": token,
        "upload_url": f"/upload/{token}",
        "chunk_size": CHUNK_SIZE,
        "state": "ready",
    }


@upload_router.put("/{token}")
async def upload_chunk(
    token: str, request: Request, chunk: int = Query(..., ge=0)
) -> dict:
    """Nhận 1 chunk (raw bytes); verify ``X-Chunk-Sha256`` nếu có; ghi tạm→đổi tên atomic."""
    settings = _settings_of(request)
    session = _get_session(token)
    body = await request.body()

    if "x-chunk-sha256" in request.headers:
        expected = request.headers["x-chunk-sha256"].strip().lower()
        actual = hashlib.sha256(body).hexdigest()
        if expected != actual:
            raise AppError(ErrorCode.invalid_request, "chunk sha mismatch")

    staging_dir = staging_root(settings) / token
    tmp_path = staging_dir / f"{chunk:06d}.chunk.tmp"
    final_path = staging_dir / f"{chunk:06d}.chunk"
    tmp_path.write_bytes(body)
    os.replace(tmp_path, final_path)  # atomic trên cùng thư mục

    with _SESSIONS_LOCK:
        session.chunk_count = max(session.chunk_count, chunk + 1)
    return {"received": chunk, "bytes": len(body)}


@upload_router.post("/{token}/complete")
def complete_upload(token: str, request: Request) -> dict:
    """Ghép chunk theo thứ tự → hash tổng → ghi VFS (nhỏ) hoặc blob sidecar (≥32MB)."""
    settings = _settings_of(request)
    session = _get_session(token)
    vfs_not_found_guard(session.workspace_id, settings)

    staging_dir = staging_root(settings) / token
    paths = _chunk_files(staging_dir)
    indices = {int(p.stem) for p in paths}
    missing = next((i for i in range(session.chunk_count) if i not in indices), None)
    if missing is not None:
        raise AppError(ErrorCode.invalid_request, f"thiếu chunk {missing}")

    total_size = sum(p.stat().st_size for p in paths)

    # Lượt 1: hash tổng trên khí ghép (đơn giản, chấp nhận PoC — lượt 2 để ghi).
    hasher = hashlib.sha256()
    for block in _iter_chunk_bytes(paths):
        hasher.update(block)
    sha = hasher.hexdigest()
    if session.expected_sha256 and session.expected_sha256.strip().lower() != sha:
        # Giữ staging + phiên chưa completed để client gửi lại chunk đúng rồi complete.
        raise AppError(ErrorCode.conflict, "sha256 tổng lệch")

    # Hạn mức §6.4: chặn bằng kích thước THỰC nhận được (trước khi ghi blob rời).
    db_path = workspace_db_path(session.workspace_id, settings)
    conn = connect_workspace_db(db_path)
    try:
        check_quota(used_bytes(conn), total_size, settings.workspace_quota_bytes)
    finally:
        conn.close()

    vfs = get_vfs(session.workspace_id, settings)
    if total_size >= settings.blob_sidecar_min_bytes:
        # Đường blob sidecar: sidecar do route này ghi trước, import_blob chỉ ghi row.
        vfs.blobs.write_stream(sha, _iter_chunk_bytes(paths))
        result = vfs.import_blob(session.path, sha, total_size)
        storage = "blob"
    else:
        # File nhỏ đi đường chunked: ghép bytes (≤ ngưỡng 32MB) rồi ghi thẳng DB.
        content = b"".join(_iter_chunk_bytes(paths))
        result = vfs.write_file(session.path, content)
        storage = "vfs"

    shutil.rmtree(staging_dir, ignore_errors=True)
    with _SESSIONS_LOCK:
        session.completed = True
    return {
        "workspace_id": session.workspace_id,
        "path": session.path,
        "sha256": sha,
        "size": total_size,
        "storage": storage,
        "rev": _extract_rev(result),
    }


@upload_router.get("/{token}/status")
def upload_status(token: str, request: Request) -> dict:
    """Trạng thái phiên: số chunk đã nằm trên đĩa, đã hoàn tất chưa, size khai báo."""
    settings = _settings_of(request)
    session = _get_session(token, allow_completed=True)
    chunks_received = len(_chunk_files(staging_root(settings) / token))
    return {
        "token": token,
        "chunks_received": chunks_received,
        "completed": session.completed,
        "declared_size": session.declared_size,
    }


@upload_router.delete("/{token}")
def cancel_upload(token: str, request: Request) -> dict:
    """Hủy phiên: bỏ registry + xóa thư mục staging."""
    settings = _settings_of(request)
    with _SESSIONS_LOCK:
        session = _SESSIONS.pop(token, None)
    if session is None:
        raise _not_found("Phiên upload không tồn tại")
    shutil.rmtree(staging_root(settings) / token, ignore_errors=True)
    return {"cancelled": True}


# ------------------------------------------------------------------ download


def _iter_stream(fp, read_size: int = _STREAM_READ_SIZE) -> Iterator[bytes]:
    """Stream từ BinaryIO theo lượt nhỏ, đóng file khi xong (kể cả ngắt giữa chừng)."""
    try:
        while True:
            block = fp.read(read_size)
            if not block:
                break
            yield block
    finally:
        fp.close()


def _iter_db_content(db_path: Path, path: str) -> Iterator[bytes]:
    """Stream content file ``vfs`` từ SQLite bằng incremental blob I/O — không load cả BLOB."""
    conn = connect_workspace_db(db_path)
    try:
        row = conn.execute("SELECT rowid FROM files WHERE path = ?", (path,)).fetchone()
        if row is None:
            raise AppError(ErrorCode.file_not_found, f"File không tồn tại: '{path}'")
        try:
            blob = conn.blobopen("files", "content", row["rowid"])
        except (AttributeError, sqlite3.OperationalError):
            # Content NULL/rỗng hoặc bản Python thiếu blobopen → trả stream rỗng.
            return
        with blob:
            while True:
                block = blob.read(_STREAM_READ_SIZE)
                if not block:
                    break
                yield block
    finally:
        conn.close()


@download_router.get("/download/{workspace_id}")
def download_file(workspace_id: str, request: Request, path: str = Query(...)) -> StreamingResponse:
    """Stream file về client: blob sidecar đọc qua BlobStore, file nhỏ đọc từ DB."""
    settings = _settings_of(request)
    vfs_not_found_guard(workspace_id, settings)

    from sandbox_kit_clone.vfs.paths import canonicalize_path

    canonical = canonicalize_path(path)
    vfs = get_vfs(workspace_id, settings)
    try:
        info = vfs.get_file_info(canonical)
        if info is None:
            raise AppError(ErrorCode.file_not_found, f"File không tồn tại: '{canonical}'")
        if info["storage_class"] == "blob" and info["blob_ref"]:
            stream = vfs.blobs.open_stream(info["blob_ref"])
            iterator: Iterator[bytes] = _iter_stream(stream)
        else:
            iterator = _iter_db_content(vfs.workspace_db_path, canonical)
    finally:
        vfs.close()

    headers = {"X-File-Sha256": str(info["sha256"]), "Content-Length": str(info["size"])}
    return StreamingResponse(
        iterator, media_type="application/octet-stream", headers=headers
    )
