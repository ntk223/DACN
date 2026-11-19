"""Chuyển ``AppError`` → JSON response chuẩn cho FastAPI (dùng chung mọi router).

Ánh xạ status mặc định theo mã lỗi; route có thể ghi đè status cho từng lần raise
bằng ``details={"http_status": <int>}`` (khóa này bị gỡ khỏi payload trước khi trả).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from sandbox_kit_clone.errors import AppError, ErrorCode

_STATUS_BY_CODE: dict[ErrorCode, int] = {
    ErrorCode.file_not_found: 404,
    ErrorCode.workspace_not_found: 404,
    ErrorCode.conflict: 409,
    ErrorCode.quota_exceeded: 413,
    ErrorCode.provider_unavailable: 503,
    ErrorCode.agent_unavailable: 503,
}

_HTTP_STATUS_KEY = "http_status"
_INTERNAL_MESSAGE = "Lỗi hệ thống — xem log máy chủ để biết chi tiết."


def install_error_handlers(app: FastAPI) -> None:
    """Gắn handler ``AppError`` + ``Exception`` cho app (gọi 1 lần khi dựng app)."""

    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        status = _STATUS_BY_CODE.get(exc.code, 400)
        details = dict(exc.details) if exc.details else None
        if details and _HTTP_STATUS_KEY in details:
            override = details.pop(_HTTP_STATUS_KEY)
            if isinstance(override, int):
                status = override
        error: dict = {"code": exc.code.value, "message": exc.message}
        if details:
            error["details"] = details
        return JSONResponse(status_code=status, content={"error": error})

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, _exc: Exception) -> JSONResponse:
        # Không lộ traceback ra response — chi tiết lỗi chỉ nằm ở log máy chủ.
        return JSONResponse(
            status_code=500,
            content={
                "error": {"code": ErrorCode.internal_error.value, "message": _INTERNAL_MESSAGE}
            },
        )
