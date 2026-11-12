"""VFS — kho file trung tâm trên SQLite, mỗi workspace một database.

Sở hữu ghi ĐỘC QUYỀN workspace DB (nguyên tắc 3): mọi thay đổi file (ghi/sửa/
xóa) là MỘT transaction gồm row files + history (C5) + bump
``workspace_revision``. 1 process, 1 writer — mutations được bảo vệ bằng
``threading.Lock``. Không biết sandbox tồn tại; không tự sync (W3).
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.vfs.blob import BlobStore
from sandbox_kit_clone.vfs.fuzzy import fuzzy_replace
from sandbox_kit_clone.vfs.ignore import check_write_allowed
from sandbox_kit_clone.vfs.paths import canonicalize_path
from sandbox_kit_clone.vfs.quota import check_quota, used_bytes
from sandbox_kit_clone.vfs.schema import init_workspace_db

# Trần lịch sử: tối đa 20 patch mỗi file (C5).
MAX_REVISIONS_PER_FILE = 20

# Trần kích thước patch full-content: lớn hơn → placeholder (C5).
PATCH_MAX_BYTES = 1_000_000

# is_binary: có byte NULL trong 8000 byte đầu.
_BINARY_SNIFF_BYTES = 8000

_VALID_DELETE_ORIGINS = ("vfs", "sandbox")


def _utcnow_iso() -> str:
    """Mốc thời gian chuẩn dùng chung (UTC ISO 8601)."""
    return datetime.now(UTC).isoformat()


def _is_binary(data: bytes) -> int:
    """1 nếu dữ liệu trông nhị phân (có ``\\0`` trong 8000 byte đầu), 0 nếu không."""
    return 1 if b"\x00" in data[:_BINARY_SNIFF_BYTES] else 0


def _patch_text(data: bytes, size: int) -> str:
    """Nội dung patch cho ``file_revisions``: full text mới nếu nhỏ + không nhị phân."""
    if size <= PATCH_MAX_BYTES and b"\x00" not in data:
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            pass
    return f"[full-content-skipped: {size} bytes]"


class VFS:
    """Khối lõi VFS: ghi/đọc/sửa/xóa file + revision + history + tombstone."""

    def __init__(self, workspace_db_path: Path, settings: Settings) -> None:
        self.workspace_db_path = Path(workspace_db_path)
        # §6.1: DB = workspaces/{id}.sqlite, sidecar = workspaces/{id}/blobs/ —
        # workspace_dir tính từ stem để mỗi dự án có thư mục riêng, xóa dự án
        # (DB + thư mục) giải phóng 100%.
        self.workspace_dir = self.workspace_db_path.parent / self.workspace_db_path.stem
        self.workspace_dir.mkdir(parents=True, exist_ok=True)  # sidecar/temp cần thư mục sẵn
        self.settings = settings
        self.blobs = BlobStore(self.workspace_dir / "blobs")
        self._conn = init_workspace_db(self.workspace_db_path)
        # Override isolation_level (không sửa file W1.1): autocommit mode để
        # kiểm soát transaction thủ công bằng BEGIN IMMEDIATE / COMMIT.
        self._conn.isolation_level = None
        self._lock = threading.Lock()

    @property
    def revision(self) -> int:
        """Phiên bản hiện tại của workspace (workspace_meta.workspace_revision)."""
        with self._lock:
            return self._read_revision()

    def close(self) -> None:
        """Đóng connection (teardown test / shutdown)."""
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------------- writes

    def write_file(self, path: str, content: bytes | str, force: bool = False) -> dict:
        """Ghi (tạo mới hoặc đè) file vào kho; trả metadata kết quả.

        Cùng nội dung (same-sha) → no-op: không bump revision, không ghi history.
        """
        canonical = canonicalize_path(path)
        data = content.encode("utf-8") if isinstance(content, str) else bytes(content)
        warnings = check_write_allowed(canonical, force)
        return self._write(canonical, data, warnings)

    def edit_file(self, path: str, old_text: str, new_text: str, force: bool = False) -> dict:
        """Sửa file bằng fuzzy replace; đi cùng pipeline ghi như ``write_file``."""
        canonical = canonicalize_path(path)
        warnings = check_write_allowed(canonical, force)
        data = self.read_file(canonical)
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AppError(
                ErrorCode.invalid_request,
                f"File không phải văn bản UTF-8, không edit được: '{canonical}'",
            ) from exc
        replaced, used_fuzzy = fuzzy_replace(text, old_text, new_text)
        result = self._write(canonical, replaced.encode("utf-8"), warnings)
        return {
            "path": result["path"],
            "rev": result["rev"],
            "sha256": result["sha256"],
            "size": result["size"],
            "used_fuzzy": used_fuzzy,
            "warnings": result["warnings"],
        }

    def import_blob(self, path: str, sha256: str, size: int, force: bool = False) -> dict:
        """Ghi row file lớn lưu rời (sidecar) — gọi bởi chunked upload complete (W1.4).

        Sidecar ĐÃ được ghi qua ``BlobStore.write_stream`` (đã verify sha) TRƯỚC
        khi gọi; method này KHÔNG copy dữ liệu và KHÔNG kiểm tra sidecar tồn tại
        (trách nhiệm caller) — chỉ ghi row + bump revision + history như
        ``_write``. ``is_binary`` đặt 0 vì chưa đọc nội dung.
        """
        canonical = canonicalize_path(path)
        warnings = check_write_allowed(canonical, force)
        if not isinstance(size, int) or size < 0:
            raise AppError(ErrorCode.invalid_request, f"size không hợp lệ: {size!r}")
        with self._lock:
            row = self._fetch_file(canonical)
            if row is not None and row["sha256"] == sha256:
                return self._noop_response(row, canonical)
            check_quota(used_bytes(self._conn), size, self.settings.workspace_quota_bytes)
            now = _utcnow_iso()
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                new_rev = self._read_revision() + 1
                self._upsert_file_row(
                    path=canonical,
                    content=None,
                    size=size,
                    sha256=sha256,
                    mtime=now,
                    is_binary=0,
                    storage_class="blob",
                    blob_ref=sha256,
                    rev=new_rev,
                )
                if row is not None:
                    self._insert_history(
                        path=canonical,
                        patch=f"[full-content-skipped: {size} bytes]",
                        before_sha=row["sha256"],
                        after_sha=sha256,
                        created_at=now,
                    )
                self._bump_revision(new_rev)
                self._conn.execute("COMMIT")
            except Exception:
                self._safe_rollback()
                raise
            return {
                "path": canonical,
                "rev": new_rev,
                "sha256": sha256,
                "size": size,
                "storage_class": "blob",
                "warnings": warnings,
            }

    def delete_file(self, path: str, origin: str = "vfs") -> dict:
        """Xóa file: xóa row files + ghi tombstone + bump revision (1 transaction)."""
        if origin not in _VALID_DELETE_ORIGINS:
            raise AppError(
                ErrorCode.invalid_request,
                f"origin chỉ nhận {'|'.join(_VALID_DELETE_ORIGINS)}, nhận được: {origin!r}",
            )
        canonical = canonicalize_path(path)
        with self._lock:
            row = self._fetch_file(canonical)
            if row is None:
                raise AppError(
                    ErrorCode.file_not_found, f"File không tồn tại: '{canonical}'"
                )
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                new_rev = self._read_revision() + 1
                self._conn.execute(
                    "INSERT INTO tombstones (path, rev, sha256, origin, blob_ref)"
                    " VALUES (?, ?, ?, ?, ?)"
                    " ON CONFLICT(path) DO UPDATE SET"
                    " rev = excluded.rev, sha256 = excluded.sha256,"
                    " origin = excluded.origin, blob_ref = excluded.blob_ref",
                    (canonical, new_rev, row["sha256"], origin, row["blob_ref"]),
                )
                self._conn.execute("DELETE FROM files WHERE path = ?", (canonical,))
                self._bump_revision(new_rev)
                self._conn.execute("COMMIT")
            except Exception:
                self._safe_rollback()
                raise
            return {
                "path": canonical,
                "rev": new_rev,
                "sha256": row["sha256"],
                "origin": origin,
            }

    def set_synced_sha(self, path: str, sha256: str) -> None:
        """Cập nhật ``synced_sha256`` — hook cho sync W3 (push-ack / pull-apply).

        Không bump revision, không ghi history: chỉ đánh dấu "bản sao chắc chắn
        có trong sandbox". File không tồn tại → không làm gì cả (tombstone do
        phía sync xử lý).
        """
        canonical = canonicalize_path(path)
        with self._lock:
            self._conn.execute(
                "UPDATE files SET synced_sha256 = ? WHERE path = ?", (sha256, canonical)
            )

    # -------------------------------------------------------------------- reads

    def read_file(self, path: str) -> bytes:
        """Đọc toàn bộ nội dung file; không có (kể cả tombstone) → ``file_not_found``."""
        canonical = canonicalize_path(path)
        with self._lock:
            row = self._fetch_file(canonical)
        if row is None:
            raise AppError(ErrorCode.file_not_found, f"File không tồn tại: '{canonical}'")
        if row["storage_class"] == "blob" and row["blob_ref"]:
            with self.blobs.open_stream(row["blob_ref"]) as stream:
                return stream.read()
        return bytes(row["content"])

    def list_files(self) -> list[dict]:
        """Danh sách file (không content): path, size, rev, storage_class, is_binary."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT path, size, rev, storage_class, is_binary FROM files ORDER BY path"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_file_info(self, path: str) -> dict | None:
        """Metadata đầy đủ của 1 file; không có → ``None``."""
        canonical = canonicalize_path(path)
        with self._lock:
            row = self._conn.execute(
                "SELECT path, size, sha256, rev, storage_class, blob_ref,"
                " synced_sha256, mtime, is_binary FROM files WHERE path = ?",
                (canonical,),
            ).fetchone()
        return dict(row) if row is not None else None

    def get_revisions(self, path: str, limit: int = 20) -> list[dict]:
        """Lịch sử patch của file (mới nhất trước), tối đa ``limit`` bản."""
        canonical = canonicalize_path(path)
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, path, patch, before_sha, after_sha, created_at"
                " FROM file_revisions WHERE path = ? ORDER BY id DESC LIMIT ?",
                (canonical, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    # ---------------------------------------------------------------- internals

    def _write(self, path: str, data: bytes, warnings: list[str]) -> dict:
        """Pipeline ghi dùng chung cho write_file + edit_file (đường dẫn đã chuẩn).

        Trình tự: same-sha no-op (C5) → quota (C1) → lưu sidecar nếu ≥ ngưỡng →
        MỘT transaction (upsert files + history + cap 20 patch + bump revision).
        """
        sha = hashlib.sha256(data).hexdigest()
        size = len(data)
        with self._lock:
            row = self._fetch_file(path)
            if row is not None and row["sha256"] == sha:
                return self._noop_response(row, path)

            check_quota(used_bytes(self._conn), size, self.settings.workspace_quota_bytes)

            content_value: bytes | None = data
            storage_class = "vfs"
            blob_ref: str | None = None
            if size >= self.settings.blob_sidecar_min_bytes:
                blob_ref = self._store_sidecar(data)
                storage_class = "blob"
                content_value = None

            now = _utcnow_iso()
            is_binary = _is_binary(data)
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                new_rev = self._read_revision() + 1
                self._upsert_file_row(
                    path=path,
                    content=content_value,
                    size=size,
                    sha256=sha,
                    mtime=now,
                    is_binary=is_binary,
                    storage_class=storage_class,
                    blob_ref=blob_ref,
                    rev=new_rev,
                )
                if row is not None:
                    self._insert_history(
                        path=path,
                        patch=_patch_text(data, size),
                        before_sha=row["sha256"],
                        after_sha=sha,
                        created_at=now,
                    )
                    self._cap_revisions(path)
                self._bump_revision(new_rev)
                self._conn.execute("COMMIT")
            except Exception:
                self._safe_rollback()
                raise
            return {
                "path": path,
                "rev": new_rev,
                "sha256": sha,
                "size": size,
                "storage_class": storage_class,
                "warnings": warnings,
            }

    def _store_sidecar(self, data: bytes) -> str:
        """Ghi nội dung ≥ ngưỡng ra temp file trong workspace_dir → BlobStore."""
        fd, tmp_name = tempfile.mkstemp(dir=self.workspace_dir, prefix=".vfs-", suffix=".tmp")
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            return self.blobs.store_file(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)

    def _upsert_file_row(
        self,
        *,
        path: str,
        content: bytes | None,
        size: int,
        sha256: str,
        mtime: str,
        is_binary: int,
        storage_class: str,
        blob_ref: str | None,
        rev: int,
    ) -> None:
        """Upsert files; ``synced_sha256`` giữ giá trị cũ khi UPDATE, NULL khi INSERT."""
        self._conn.execute(
            "INSERT INTO files (path, content, size, sha256, mtime, is_binary,"
            " storage_class, blob_ref, rev, synced_sha256)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)"
            " ON CONFLICT(path) DO UPDATE SET"
            " content = excluded.content, size = excluded.size, sha256 = excluded.sha256,"
            " mtime = excluded.mtime, is_binary = excluded.is_binary,"
            " storage_class = excluded.storage_class, blob_ref = excluded.blob_ref,"
            " rev = excluded.rev, synced_sha256 = files.synced_sha256",
            (path, content, size, sha256, mtime, is_binary, storage_class, blob_ref, rev),
        )

    def _insert_history(
        self, *, path: str, patch: str, before_sha: str, after_sha: str, created_at: str
    ) -> None:
        self._conn.execute(
            "INSERT INTO file_revisions (path, patch, before_sha, after_sha, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (path, patch, before_sha, after_sha, created_at),
        )

    def _cap_revisions(self, path: str) -> None:
        """Giữ tối đa ``MAX_REVISIONS_PER_FILE`` bản mới nhất cho 1 path (C5)."""
        self._conn.execute(
            "DELETE FROM file_revisions WHERE path = ? AND id NOT IN ("
            " SELECT id FROM file_revisions WHERE path = ? ORDER BY id DESC LIMIT ?)",
            (path, path, MAX_REVISIONS_PER_FILE),
        )

    def _fetch_file(self, path: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT path, content, size, sha256, mtime, is_binary, storage_class,"
            " blob_ref, rev, synced_sha256 FROM files WHERE path = ?",
            (path,),
        ).fetchone()

    def _read_revision(self) -> int:
        row = self._conn.execute(
            "SELECT workspace_revision FROM workspace_meta WHERE id = 1"
        ).fetchone()
        return int(row[0])

    def _bump_revision(self, new_rev: int) -> None:
        self._conn.execute(
            "UPDATE workspace_meta SET workspace_revision = ? WHERE id = 1", (new_rev,)
        )

    def _noop_response(self, row: sqlite3.Row, path: str) -> dict:
        return {
            "path": path,
            "sha256": row["sha256"],
            "rev": row["rev"],
            "size": row["size"],
            "storage_class": row["storage_class"],
            "noop": True,
            "warnings": [],
        }

    def _safe_rollback(self) -> None:
        try:
            self._conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
