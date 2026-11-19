"""Bộ lỗi chuẩn của hệ thống: ``ErrorCode`` thống nhất + ``AppError`` có payload."""

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    """Mã lỗi thống nhất trả về qua gateway (giá trị = chuỗi dùng trong payload)."""

    workspace_not_found = "workspace_not_found"
    session_not_found = "session_not_found"
    file_not_found = "file_not_found"
    ignored_path = "ignored_path"
    quota_exceeded = "quota_exceeded"
    invalid_path = "invalid_path"
    invalid_request = "invalid_request"
    conflict = "conflict"
    provider_unavailable = "provider_unavailable"
    internal_error = "internal_error"


class AppError(Exception):
    """Lỗi ứng dụng có phân loại; chuyển thẳng sang payload chuẩn qua ``to_payload()``."""

    def __init__(self, code: ErrorCode, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    def to_payload(self) -> dict:
        """Payload chuẩn: ``{"error": {"code", "message", "details"?}}`` — details bỏ khi None."""
        error: dict = {"code": self.code.value, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"error": error}

    def __str__(self) -> str:
        return f"{self.code.value}: {self.message}"
