"""BlobStore — file rời cho file lớn (≥32MB, C1): thư mục ``blobs/`` tên = sha256 hex.

Ghi atomic: ghi tạm ``.{sha}.tmp`` → fsync → rename. Nội dung dedupe theo
sha256: file đã tồn tại → bỏ qua ghi. Trách nhiệm caller: ``import_blob`` của
VFS KHÔNG kiểm tra sidecar tồn tại — ai gọi ``import_blob`` phải đảm bảo
sidecar đã được ghi (trực tiếp hoặc qua ``write_stream``) trước đó.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Iterable
from pathlib import Path
from typing import BinaryIO

from sandbox_kit_clone.errors import AppError, ErrorCode

# Đọc/ghi theo khối 1MB — tránh nạp cả file lớn vào bộ nhớ.
_CHUNK_SIZE = 1024 * 1024

# sha256 hex hợp lệ (chữ thường; chữ hoa được chấp nhận rồi hạ về thường) —
# đồng thời là hàng rào path traversal vì sha được dùng làm tên file.
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _validate_sha(sha256: str) -> str:
    """Kiểm tra định dạng sha256 hex (64 ký tự) → trả về dạng chữ thường."""
    if not isinstance(sha256, str) or _SHA256_RE.fullmatch(sha256) is None:
        raise AppError(
            ErrorCode.invalid_request,
            f"sha256 không hợp lệ (cần 64 ký tự hex): {sha256!r}",
        )
    return sha256.lower()


class BlobStore:
    """Kho file rời content-addressed: ``root/{sha256}`` — ghi atomic, dedupe."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def path_of(self, sha256: str) -> Path:
        """Đường dẫn file rời tương ứng với ``sha256``."""
        return self.root / _validate_sha(sha256)

    def has(self, sha256: str) -> bool:
        """True nếu blob đã tồn tại trên đĩa."""
        return self.path_of(sha256).is_file()

    def store_file(self, src: Path) -> str:
        """Lưu file ``src`` vào kho; trả sha256 hex (tính bằng stream).

        Nội dung đã tồn tại (``has``) → bỏ qua ghi.
        """
        src = Path(src)
        digest = hashlib.sha256()
        with src.open("rb") as stream:
            while chunk := stream.read(_CHUNK_SIZE):
                digest.update(chunk)
        sha = digest.hexdigest()
        if self.has(sha):
            return sha
        with src.open("rb") as source:
            self._atomic_write(sha, source)
        return sha

    def write_stream(self, sha256: str, chunks: Iterable[bytes]) -> int:
        """Ghi blob từ iterator khối (stream chunked upload); trả tổng bytes.

        Luôn stream toàn bộ khối qua hash để verify: sha256 thực tế phải khớp
        tham số, không khớp → ``AppError(invalid_request)`` và không ghi gì.
        Đã ``has`` sẵn → vẫn verify, rồi trả kích thước hiện có (bỏ qua rename).
        """
        expected = _validate_sha(sha256)
        tmp_path = self.root / f".{expected}.tmp"
        self.root.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        total = 0
        try:
            with tmp_path.open("wb") as out:
                for chunk in chunks:
                    if not chunk:
                        continue
                    digest.update(chunk)
                    total += len(chunk)
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            actual = digest.hexdigest()
            if actual != expected:
                raise AppError(
                    ErrorCode.invalid_request,
                    f"sha256 nội dung không khớp: mong đợi {expected}, thực tế {actual}",
                )
            if self.has(expected):
                # Đã có blob cùng nội dung (sha khớp) → bỏ qua rename.
                return os.path.getsize(self.root / expected)
            os.replace(tmp_path, self.root / expected)
            return total
        finally:
            tmp_path.unlink(missing_ok=True)

    def open_stream(self, sha256: str) -> BinaryIO:
        """Mở blob ở chế độ ``rb``; thiếu → ``AppError(file_not_found)``."""
        path = self.path_of(sha256)
        try:
            return path.open("rb")
        except FileNotFoundError as exc:
            raise AppError(
                ErrorCode.file_not_found,
                f"Blob không tồn tại trong sidecar store: {sha256}",
            ) from exc

    def delete(self, sha256: str) -> None:
        """Xóa blob nếu có; thiếu thì không raise (idempotent)."""
        self.path_of(sha256).unlink(missing_ok=True)

    # ------------------------------------------------------------------ internals

    def _atomic_write(self, sha: str, source: BinaryIO) -> None:
        """Ghi ``source`` ra ``.{sha}.tmp`` → fsync → rename thành ``{sha}``."""
        tmp_path = self.root / f".{sha}.tmp"
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            with tmp_path.open("wb") as out:
                while chunk := source.read(_CHUNK_SIZE):
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp_path, self.root / sha)
        finally:
            tmp_path.unlink(missing_ok=True)
