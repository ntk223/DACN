"""Đăng ký bộ tool MCP (docs/system-design.md §4) lên một instance FastMCP.

Mẫu lỗi thống nhất: mọi tool KHÔNG raise ra ngoài kênh MCP — ``AppError`` gói thành
``{"error": {"code", "message", "details"?}}``; lỗi bất ngờ → code ``internal_error``.
``register_tools`` trả về dict tham chiếu hàm gốc để test gọi trực tiếp (không cần
transport MCP); app chính đặt dict này vào ``app.state.tool_fns``.
"""

from __future__ import annotations

import base64
from collections.abc import Callable
from urllib.parse import quote

from mcp.server.fastmcp import FastMCP

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.manager.manager import Manager

FILE_TOO_LARGE_CODE = "file_too_large"


def _safe(fn: Callable[[], dict]) -> dict:
    """Ranh giới lỗi chung cho mọi tool: ``AppError`` → payload chuẩn; còn lại → internal_error."""
    try:
        return fn()
    except AppError as exc:
        return exc.to_payload()
    except Exception as exc:  # noqa: BLE001 — ranh giới MCP: lỗi bất ngờ phải thành payload
        return {
            "error": {
                "code": ErrorCode.internal_error.value,
                "message": f"Lỗi không mong muốn: {exc}",
            }
        }


def register_tools(mcp: FastMCP, manager: Manager) -> dict[str, Callable]:
    """Đăng ký toàn bộ tool W1 lên ``mcp``; trả về ``{tool_name: hàm_gốc}`` cho test."""
    tools: dict[str, Callable] = {}

    # ------------------------------------------------------------- workspace

    @mcp.tool()
    def workspace_create(name: str = "") -> dict:
        """Tạo workspace + phiên làm việc mới; sinh mã tự động.

        Trả về workspace_id + session_id — agent giữ session_id cho mọi tool sau.
        """
        return _safe(lambda: manager.create_workspace(name))

    tools["workspace_create"] = workspace_create

    # -------------------------------------------------------------- sandbox

    @mcp.tool()
    def sandbox_start(
        session_id: str, ttl_seconds: int = 3600, cpu: int | None = None, memory: int | None = None
    ) -> dict:
        """Chạy sandbox cho phiên (chỉ khi STANDBY); ttl <= 0 nghĩa là không hết hạn.

        Trả về sandbox_id + dial_target để nối vào trình thực thi bên trong sandbox.
        """
        return _safe(lambda: manager.sandbox_start(session_id, ttl_seconds, cpu, memory))

    tools["sandbox_start"] = sandbox_start

    @mcp.tool()
    def sandbox_stop(session_id: str) -> dict:
        """Hủy sandbox của phiên (RUNNING/PAUSED); phiên về STANDBY."""
        return _safe(lambda: manager.sandbox_stop(session_id))

    tools["sandbox_stop"] = sandbox_stop

    @mcp.tool()
    def sandbox_pause(session_id: str) -> dict:
        """Tạm dừng sandbox đang RUNNING; phiên chuyển PAUSED."""
        return _safe(lambda: manager.sandbox_pause(session_id))

    tools["sandbox_pause"] = sandbox_pause

    @mcp.tool()
    def sandbox_resume(session_id: str) -> dict:
        """Tiếp tục sandbox đang PAUSED; phiên quay lại RUNNING."""
        return _safe(lambda: manager.sandbox_resume(session_id))

    tools["sandbox_resume"] = sandbox_resume

    @mcp.tool()
    def sandbox_renew(session_id: str, ttl_seconds: int) -> dict:
        """Gia hạn thời hạn sống của sandbox thêm ``ttl_seconds`` giây."""
        return _safe(lambda: manager.sandbox_renew(session_id, ttl_seconds))

    tools["sandbox_renew"] = sandbox_renew

    @mcp.tool()
    def sandbox_status(session_id: str) -> dict:
        """Xem trạng thái phiên + sandbox (state, sandbox_id, provider_state, hạn)."""
        return _safe(lambda: manager.sandbox_status(session_id))

    tools["sandbox_status"] = sandbox_status

    # ----------------------------------------------------------------- files

    @mcp.tool()
    def file_write(session_id: str, path: str, content: str, force: bool = False) -> dict:
        """Ghi (tạo mới hoặc đè) file vào kho của phiên.

        File lớn hơn ~3MB KHÔNG đi qua tool này — trả kèm upload_hint, dùng đường
        upload theo phần (POST /upload). force=true ghi đè vào thư mục ignore
        (node_modules...) — file sẽ bị 'đóng băng' với đồng bộ W3.
        """
        return _safe(lambda: _file_write(manager, session_id, path, content, force))

    tools["file_write"] = file_write

    @mcp.tool()
    def file_read(session_id: str, path: str) -> dict:
        """Đọc file: nội dung text/base64 kèm metadata, hoặc download_url nếu file lớn."""
        return _safe(lambda: _file_read(manager, session_id, path))

    tools["file_read"] = file_read

    @mcp.tool()
    def file_edit(
        session_id: str, path: str, old_text: str, new_text: str, force: bool = False
    ) -> dict:
        """Sửa file bằng thay thế old_text → new_text (khớp chính xác rồi khớp mờ).

        Trả về used_fuzzy=True khi đã dùng khớp mờ (chấp nhận lệch khoảng trắng).
        """
        return _safe(lambda: _file_edit(manager, session_id, path, old_text, new_text, force))

    tools["file_edit"] = file_edit

    @mcp.tool()
    def file_delete(session_id: str, path: str) -> dict:
        """Xóa file khỏi kho (để lại dấu vết tombstone, revision tăng)."""
        return _safe(lambda: _file_delete(manager, session_id, path))

    tools["file_delete"] = file_delete

    @mcp.tool()
    def file_list(session_id: str) -> dict:
        """Liệt kê toàn bộ file trong kho: path, size, rev, storage_class, is_binary."""
        return _safe(lambda: _file_list(manager, session_id))

    tools["file_list"] = file_list

    # ------------------------------------------------------------------ sync

    @mcp.tool()
    def sync_status(session_id: str) -> dict:
        """Xem trạng thái đồng bộ kho ↔ sandbox (W1: revision + status đặt sẵn)."""
        return _safe(lambda: manager.sync_status(session_id))

    tools["sync_status"] = sync_status

    return tools


# ------------------------------------------------------- hiện thực tool file


def _file_write(manager: Manager, session_id: str, path: str, content: str, force: bool) -> dict:
    _, vfs = manager.resolve_session(session_id)
    data = content.encode("utf-8")
    if len(data) > manager.settings.inline_max_bytes:
        return {
            "error": {
                "code": FILE_TOO_LARGE_CODE,
                "message": (
                    f"File {len(data)} bytes vượt ngưỡng inline"
                    f" {manager.settings.inline_max_bytes} bytes — dùng đường upload theo"
                    " phần: POST /upload (khai báo) → PUT /upload/{token} (từng chunk)"
                    " → POST /upload/{token}/complete."
                ),
                "upload_hint": True,
            }
        }
    return vfs.write_file(path, data, force=force)


def _file_read(manager: Manager, session_id: str, path: str) -> dict:
    workspace_id, vfs = manager.resolve_session(session_id)
    info = vfs.get_file_info(path)
    if info is None:
        raise AppError(ErrorCode.file_not_found, f"File không tồn tại: '{path}'")
    if info["size"] >= manager.settings.inline_max_bytes:
        return {
            "download_url": f"/download/{workspace_id}?path={quote(path)}",
            "size": info["size"],
            "sha256": info["sha256"],
            "storage_class": info["storage_class"],
        }
    data = vfs.read_file(path)
    meta = {
        "size": info["size"],
        "sha256": info["sha256"],
        "is_binary": info["is_binary"],
        "storage_class": info["storage_class"],
    }
    if info["is_binary"]:
        return {"content": base64.b64encode(data).decode("ascii"), "encoding": "base64", **meta}
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        # Không có \0 (is_binary=0) nhưng vẫn không phải UTF-8 hợp lệ → trả base64.
        return {"content": base64.b64encode(data).decode("ascii"), "encoding": "base64", **meta}
    return {"content": text, **meta}


def _file_edit(
    manager: Manager, session_id: str, path: str, old_text: str, new_text: str, force: bool
) -> dict:
    _, vfs = manager.resolve_session(session_id)
    return vfs.edit_file(path, old_text, new_text, force=force)


def _file_delete(manager: Manager, session_id: str, path: str) -> dict:
    _, vfs = manager.resolve_session(session_id)
    return vfs.delete_file(path, origin="vfs")


def _file_list(manager: Manager, session_id: str) -> dict:
    _, vfs = manager.resolve_session(session_id)
    return {"files": vfs.list_files()}
