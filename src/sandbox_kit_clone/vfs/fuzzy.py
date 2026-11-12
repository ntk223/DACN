"""Fuzzy replace cho ``edit_file`` — tìm vùng thay thế chịu lỗi whitespace/indent.

Ba mức:
  1. ``old_text`` xuất hiện ĐÚNG 1 lần → thay trực tiếp (không fuzzy).
  2. Khớp theo dòng đã chuẩn hóa whitespace (strip + collapse khoảng trắng
     nội bộ); đúng 1 vị trí → thay, giữ indent gốc của dòng đầu khớp.
  3. Không tìm thấy hoặc khớp nhiều vị trí → ``AppError(invalid_request)``.
"""

from __future__ import annotations

import re

from sandbox_kit_clone.errors import AppError, ErrorCode

# Indent = chuỗi space/tab ở đầu dòng (không tính ký tự xuống dòng).
_LEADING_WS = re.compile(r"[ \t]*")


def _normalize_line(line: str) -> str:
    """Chuẩn hóa 1 dòng: strip 2 đầu + collapse khoảng trắng nội bộ thành 1 space."""
    return " ".join(line.split())


def _find_normalized_matches(content_lines: list[str], norm_old: list[str]) -> list[int]:
    """Các vị trí dòng LIÊN TIẾP trong ``content_lines`` khớp dãy ``norm_old``."""
    span = len(norm_old)
    matches: list[int] = []
    for start in range(len(content_lines) - span + 1):
        if all(
            _normalize_line(content_lines[start + offset].rstrip("\r\n")) == norm_old[offset]
            for offset in range(span)
        ):
            matches.append(start)
    return matches


def fuzzy_replace(content: str, old_text: str, new_text: str) -> tuple[str, bool]:
    """Thay ``old_text`` bằng ``new_text`` trong ``content``.

    Trả ``(nội dung mới, used_fuzzy)``. ``used_fuzzy=False`` khi thay bằng khớp
    chính xác; ``True`` khi phải dùng khớp theo dòng chuẩn hóa whitespace.
    Không xác định được vùng thay thế duy nhất → ``AppError(invalid_request)``.
    """
    if old_text == "":
        raise AppError(
            ErrorCode.invalid_request,
            "old_text rỗng — không xác định được vùng thay thế trong file",
        )

    # Mức 1: khớp chính xác, đúng 1 lần.
    exact_count = content.count(old_text)
    if exact_count == 1:
        return content.replace(old_text, new_text, 1), False

    # Mức 2: khớp theo dòng đã chuẩn hóa whitespace.
    old_lines = old_text.splitlines()
    norm_old = [_normalize_line(line) for line in old_lines]
    content_lines = content.splitlines(keepends=True)
    matches = _find_normalized_matches(content_lines, norm_old)

    if len(matches) != 1:
        if len(matches) > 1:
            reason = f"khớp NHIỀU vị trí ({len(matches)} nơi)"
        else:
            reason = "không tìm thấy chỗ khớp nào (kể cả theo dòng đã chuẩn hóa whitespace)"
        raise AppError(
            ErrorCode.invalid_request,
            f"old_text không khớp duy nhất trong file — {reason}. Hãy cung cấp thêm"
            " ngữ cảnh xung quanh để old_text trở nên duy nhất.",
        )

    start = matches[0]
    end = start + len(norm_old)

    # Heuristic indent: lấy leading whitespace của dòng content ĐẦU TIÊN trong
    # vùng khớp, áp cho mọi dòng của new_text sau khi strip-left từng dòng.
    indent = _LEADING_WS.match(content_lines[start]).group(0)
    eol = "\r\n" if content_lines[start].endswith("\r\n") else "\n"
    new_lines = new_text.splitlines()
    indented = [(indent + line.lstrip()) if line.strip() else "" for line in new_lines]

    # Giữ cấu trúc dòng của vùng bị thay: nếu dòng cuối vùng (hoặc new_text)
    # có ký tự xuống dòng thì nội dung thay cũng kết thúc bằng xuống dòng.
    had_trailing_newline = content_lines[end - 1].endswith(("\n", "\r"))
    want_trailing_newline = had_trailing_newline or new_text.endswith(("\n", "\r"))
    body = eol.join(indented)
    if indented and want_trailing_newline:
        body += eol

    return "".join(content_lines[:start]) + body + "".join(content_lines[end:]), True
