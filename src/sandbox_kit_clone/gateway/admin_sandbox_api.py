"""REST cho trang quản lý sandbox (``/admin/sandboxes``) — dev tool, KHÔNG nằm trong OpenAPI.

Thao tác vòng đời đi qua đúng ``Manager`` (cùng kiểm trạng thái + ghi sổ thao tác như tool
MCP). Phần xem (file trong /workspace, log, số liệu) gọi thẳng các hàm tùy chọn của provider;
provider nào không có thì trả ``available: false`` thay vì lỗi.
"""

from __future__ import annotations

import base64
import codecs
import json
import queue
import threading

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.gateway.admin_api import _read_manifest
from sandbox_kit_clone.manager.manager import Manager

admin_sandbox_router = APIRouter(prefix="/admin/api", include_in_schema=False)


class StartBody(BaseModel):
    ttl_seconds: int = 3600
    cpu: float | None = None
    memory: int | None = None  # MB


class RenewBody(BaseModel):
    ttl_seconds: int = 3600


class SyncBody(BaseModel):
    full: bool = False


class PolicyBody(BaseModel):
    command: str


class ExecBody(BaseModel):
    command: str
    cwd: str = ""
    timeout_seconds: int = 0
    env: dict[str, str] = {}


def _manager(request: Request) -> Manager:
    return request.app.state.manager


def _provider_fn(manager: Manager, name: str):
    fn = getattr(manager.provider, name, None)
    return fn if callable(fn) else None


def _known_sandbox(manager: Manager, sandbox_id: str) -> None:
    if sandbox_id not in manager.provider.list_sandboxes():
        raise AppError(
            ErrorCode.invalid_request,
            f"Sandbox không tồn tại hoặc đã bị hủy: {sandbox_id}",
            details={"http_status": 404},
        )


@admin_sandbox_router.get("/sandboxes")
def overview(request: Request) -> dict:
    manager = _manager(request)
    data = manager.sandbox_overview()
    labels = _read_manifest(manager)
    for row in data["sessions"]:
        meta = labels.get(row["workspace_id"], {})
        row["workspace_name"] = meta.get("name")
        if row["state"] in ("RUNNING", "PAUSED"):
            try:
                row["sync"] = manager.sync_status(row["session_id"])
            except AppError:
                row["sync"] = None
    return data


@admin_sandbox_router.post("/sessions/{session_id}/start")
def start(request: Request, session_id: str, body: StartBody) -> dict:
    cpu = body.cpu if body.cpu and body.cpu > 0 else None
    memory = body.memory if body.memory and body.memory > 0 else None
    return _manager(request).sandbox_start(session_id, body.ttl_seconds, cpu, memory)


@admin_sandbox_router.post("/sessions/{session_id}/exec")
def exec_command(request: Request, session_id: str, body: ExecBody) -> StreamingResponse:
    """Chạy lệnh, trả NDJSON từng dòng: ``{"type":"output","stream","text"}`` … rồi
    ``{"type":"result", ...}`` (hoặc ``{"type":"error","error":{...}}``). Đi qua đúng
    ``Manager.command_run`` như tool MCP (kiểm trạng thái, ghi sổ thao tác)."""
    manager = _manager(request)
    events: queue.Queue = queue.Queue()
    decoders = {k: codecs.getincrementaldecoder("utf-8")("replace") for k in ("stdout", "stderr")}

    def on_output(stream: str, data: bytes) -> None:
        text = decoders[stream].decode(data)
        if text:
            events.put({"type": "output", "stream": stream, "text": text})

    def worker() -> None:
        try:
            result = manager.command_run(
                session_id,
                body.command,
                cwd=body.cwd,
                env=body.env or None,
                timeout_seconds=body.timeout_seconds or None,
                on_output=on_output,
                on_prepared=lambda info: events.put({"type": "prepared", **info}),
            )
            events.put({"type": "result", **result})
        except AppError as exc:
            events.put({"type": "error", **exc.to_payload()})
        except Exception as exc:  # noqa: BLE001 — trả lỗi dạng dữ liệu cho UI
            events.put({"type": "error", "error": {"code": "internal_error", "message": str(exc)}})
        finally:
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def gen():
        while True:
            item = events.get()
            if item is None:
                return
            yield json.dumps(item, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@admin_sandbox_router.post("/sessions/{session_id}/sync")
def sync_push(request: Request, session_id: str, body: SyncBody | None = None) -> dict:
    """Đẩy thay đổi VFS vào sandbox ngay (``full`` = gửi lại toàn bộ)."""
    return _manager(request).sync_push(session_id, full=bool(body and body.full))


@admin_sandbox_router.get("/sessions/{session_id}/compare")
def compare(request: Request, session_id: str) -> dict:
    """So kho với /workspace thật của sandbox theo sha256."""
    return _manager(request).sync_status(session_id) | _manager(request).sandbox_compare(session_id)


@admin_sandbox_router.post("/algo/policy")
def check_policy(request: Request, body: PolicyBody) -> dict:
    """Chạy thử bộ chặn lệnh (không chạy lệnh)."""
    return _manager(request).check_command(body.command)


@admin_sandbox_router.post("/sessions/{session_id}/{action}")
def lifecycle(request: Request, session_id: str, action: str, body: RenewBody | None = None) -> dict:
    manager = _manager(request)
    if action == "stop":
        return manager.sandbox_stop(session_id)
    if action == "pause":
        return manager.sandbox_pause(session_id)
    if action == "resume":
        return manager.sandbox_resume(session_id)
    if action == "renew":
        return manager.sandbox_renew(session_id, (body or RenewBody()).ttl_seconds)
    raise AppError(ErrorCode.invalid_request, f"Thao tác không hỗ trợ: {action}", details={"http_status": 404})


@admin_sandbox_router.get("/sandboxes/{sandbox_id}")
def detail(request: Request, sandbox_id: str) -> dict:
    manager = _manager(request)
    _known_sandbox(manager, sandbox_id)
    return manager.sandbox_detail(sandbox_id)


@admin_sandbox_router.get("/sandboxes/{sandbox_id}/logs")
def logs(request: Request, sandbox_id: str, tail: int = Query(200, ge=1, le=5000)) -> dict:
    manager = _manager(request)
    _known_sandbox(manager, sandbox_id)
    fn = _provider_fn(manager, "get_sandbox_diagnostics")
    try:
        return {"available": True, **fn(sandbox_id, tail=tail)} if fn else {"available": False}
    except NotImplementedError:
        return {"available": False}


@admin_sandbox_router.get("/sandboxes/{sandbox_id}/file")
def read_file(request: Request, sandbox_id: str, path: str = Query(...)) -> dict:
    manager = _manager(request)
    _known_sandbox(manager, sandbox_id)
    fn = _provider_fn(manager, "read_workspace_file")
    if fn is None:
        raise AppError(ErrorCode.invalid_request, "Provider không hỗ trợ đọc file trong sandbox")
    result = fn(sandbox_id, path)
    raw: bytes = result.pop("content")
    try:
        result.update(content=raw.decode("utf-8"), encoding="utf-8")
    except UnicodeDecodeError:
        result.update(content=base64.b64encode(raw).decode("ascii"), encoding="base64")
    return result


@admin_sandbox_router.delete("/sandboxes/{sandbox_id}")
def terminate_orphan(request: Request, sandbox_id: str) -> dict:
    manager = _manager(request)
    _known_sandbox(manager, sandbox_id)
    return manager.terminate_orphan(sandbox_id)
