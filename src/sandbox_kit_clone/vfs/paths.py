"""Chuẩn hóa đường dẫn trong VFS — ĐIỂM KIỂM TRA ĐƯỜNG DẪN DUY NHẤT của hệ thống.

Mọi đường dẫn đi vào kho file (write/edit/read/delete/list) phải đi qua
``canonicalize_path``: hệ thống chỉ lưu path posix tương đối, NFC, không cho
phép escape root. Quy tắc "không lưu" (thư viện, build...) nằm ở ``ignore.py``.
"""

from __future__ import annotations

import posixpath
import re
import unicodedata

from sandbox_kit_clone.errors import AppError, ErrorCode

# Độ dài tối đa của một đường dẫn hợp lệ (khớp giới hạn PATH_MAX của Linux).
MAX_PATH_LENGTH = 4096

# Drive letter kiểu Windows (``C:/...``) — được cắt bỏ khi ép về tương đối.
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")


def _invalid(reason: str) -> AppError:
    return AppError(ErrorCode.invalid_path, f"Đường dẫn không hợp lệ: {reason}")


def canonicalize_path(raw: str) -> str:
    """Chuẩn hóa ``raw`` thành path posix tương đối an toàn, ví dụ ``src/app.py``.

    Bước xử lý (theo thứ tự):
      1. Reject rỗng/whitespace, chứa NULL byte, dài > 4096 → ``invalid_path``.
      2. NFC normalize (unicodedata), đổi ``\\`` thành ``/``, ép tương đối
         (cắt drive letter + leading ``/``), rồi ``posixpath.normpath``.
      3. Reject kết quả rỗng, là ``.``/``..``, chứa segment ``..``, hoặc bắt
         đầu bằng ``/`` sau normalize (escape root) → ``invalid_path``.
    """
    if not isinstance(raw, str) or raw.strip() == "":
        raise _invalid("rỗng hoặc chỉ toàn khoảng trắng")
    if "\x00" in raw:
        raise _invalid("chứa ký tự NULL")
    if len(raw) > MAX_PATH_LENGTH:
        raise _invalid(f"quá dài ({len(raw)} > {MAX_PATH_LENGTH} ký tự)")

    normalized = unicodedata.normalize("NFC", raw).replace("\\", "/")
    # Ép tương đối: bỏ drive letter (C:/) và mọi leading '/'.
    normalized = _DRIVE_PREFIX.sub("", normalized).lstrip("/")

    candidate = posixpath.normpath(normalized)
    if candidate in ("", ".", "..") or candidate.startswith("/"):
        raise _invalid(f"escape gốc kho lưu trữ: {raw!r}")
    segments = candidate.split("/")
    if any(segment == ".." for segment in segments):
        raise _invalid(f"chứa thành phần '..': {raw!r}")
    return candidate
