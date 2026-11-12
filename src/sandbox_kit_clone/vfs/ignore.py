"""Quy tắc bỏ qua thư viện phụ thuộc — tầng 1 (tên ignore) + tầng 2 (ghi đè có chủ ý).

Bám ``docs/system-design.md`` §7.8 (C2):
  - Tầng 1: các đường nạp tự động (từ sandbox, quét Git) chặn cứng tên ignore.
  - Tầng 2: agent ghi qua tool vào path ignore → chặn mặc định, cho phép khi
    ``force=true`` — nhưng bắt buộc kèm cảnh báo "đóng băng".
  - Tầng 3 (``tmp``/``scratch``): xử lý ở ``paths.py`` — chặn tuyệt đối.
"""

from __future__ import annotations

from sandbox_kit_clone.errors import AppError, ErrorCode

# Tầng 1: thư mục không bao giờ vào kho lưu trữ qua đường tự động.
IGNORED_DIR_NAMES: frozenset[str] = frozenset(
    {
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        "dist",
        "build",
        ".cache",
        ".git",
    }
)

# Tệp rác hệ điều hành — bỏ theo tên file (basename cuối).
IGNORED_FILE_NAMES: frozenset[str] = frozenset({".DS_Store"})

_FREEZE_WARNING = (
    "File '{path}' nằm trong thư mục bị bỏ qua (ignore). File ghi kiểu 'cho phép đè'"
    " (force=true) sẽ bị 'đóng băng': các sửa đổi từ sandbox về sau KHÔNG được nhận về"
    " kho lưu trữ nữa (pull-back bỏ qua mọi file ignored)."
)


def is_ignored(path: str) -> bool:
    """True nếu ``path`` (đã canonicalize) chạm vùng ignore.

    Kiểm BẤT KỲ segment nào thuộc ``IGNORED_DIR_NAMES``, hoặc basename cuối
    thuộc ``IGNORED_FILE_NAMES``.
    """
    segments = path.split("/")
    if any(segment in IGNORED_DIR_NAMES for segment in segments):
        return True
    return segments[-1] in IGNORED_FILE_NAMES


def check_write_allowed(path: str, force: bool) -> list[str]:
    """Tầng 2 — MCP write tới path ignore.

    - Không ignore → trả ``[]``.
    - Ignore + ``force=False`` → ``AppError(ignored_path)`` (message nêu path
      và gợi ý ``force=true``).
    - Ignore + ``force=True`` → cho phép, trả danh sách warnings bắt buộc chứa
      cảnh báo "đóng băng" (file sẽ không nhận sửa đổi từ sandbox về sau).
    """
    if not is_ignored(path):
        return []
    if not force:
        raise AppError(
            ErrorCode.ignored_path,
            f"Đường dẫn '{path}' nằm trong thư mục bị bỏ qua (ignore). Ghi mặc định bị"
            " chặn — dùng force=true nếu thật sự muốn ghi đè (file sẽ bị 'đóng băng').",
        )
    return [_FREEZE_WARNING.format(path=path)]
