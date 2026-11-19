"""Quy tắc KHÔNG LƯU — kho chỉ giữ mã nguồn mà dự án sẽ đẩy lên GitHub.

Thư viện phụ thuộc, môi trường ảo, cache và sản phẩm build (những thứ thường nằm trong
``.gitignore``) không bao giờ vào kho: ghi vào các đường dẫn này → ``ignored_path``.
Một quy tắc duy nhất, không có ngoại lệ ``force`` (thay cho mô hình 3 tầng C2 của thiết kế).
"""

from __future__ import annotations

from sandbox_kit_clone.errors import AppError, ErrorCode

# Thư mục: khớp BẤT KỲ segment nào của đường dẫn.
IGNORED_DIR_NAMES: frozenset[str] = frozenset(
    {
        # thư viện phụ thuộc
        "node_modules", "bower_components", "jspm_packages",
        # môi trường ảo Python
        ".venv", "venv",
        # cache công cụ
        "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".nox",
        ".cache", ".parcel-cache", ".eggs",
        # sản phẩm build
        "dist", "build", ".next", ".nuxt", ".gradle", "htmlcov",
        # metadata VCS
        ".git",
    }
)

# Thư mục kết thúc bằng hậu tố này (vd ``mypkg.egg-info``).
IGNORED_DIR_SUFFIXES: tuple[str, ...] = (".egg-info",)

# Tên file cụ thể (basename).
IGNORED_FILE_NAMES: frozenset[str] = frozenset({".DS_Store", "Thumbs.db", ".coverage"})

# Đuôi file biên dịch.
IGNORED_FILE_SUFFIXES: tuple[str, ...] = (".pyc", ".pyo", ".class", ".o")


def ignore_reason(path: str) -> str | None:
    """Lý do ``path`` (đã canonicalize) không được lưu; ``None`` nếu được lưu."""
    *dirs, name = path.split("/")
    for segment in dirs:
        if segment in IGNORED_DIR_NAMES:
            return f"thư mục '{segment}/'"
        if segment.endswith(IGNORED_DIR_SUFFIXES):
            return f"thư mục '{segment}/'"
    if name in IGNORED_DIR_NAMES:  # chính đường dẫn là thư mục bị bỏ qua (vd ghi file tên '.git')
        return f"tên '{name}'"
    if name in IGNORED_FILE_NAMES:
        return f"file '{name}'"
    if name.endswith(IGNORED_FILE_SUFFIXES):
        return f"đuôi '{name[name.rfind('.'):]}'"
    return None


def is_ignored(path: str) -> bool:
    """True nếu ``path`` (đã canonicalize) thuộc vùng không lưu."""
    return ignore_reason(path) is not None


def ensure_storable(path: str) -> None:
    """Chặn ghi vào vùng không lưu → ``AppError(ignored_path)``; ngược lại không làm gì."""
    reason = ignore_reason(path)
    if reason is not None:
        raise AppError(
            ErrorCode.ignored_path,
            f"Không lưu '{path}': {reason} là thư viện / môi trường / cache / build"
            " — kho chỉ giữ mã nguồn mà dự án đẩy lên GitHub.",
        )
