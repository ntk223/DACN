"""REST API cho trang quản lý VFS (``/admin/vfs``) — dev tool, KHÔNG nằm trong OpenAPI.

Nguyên tắc:
- Đọc: mở VFS / connection mới mỗi request và ĐÓNG ngay sau khi dùng.
- Ghi: đi qua đúng pipeline lõi (``VFS.write_file`` / ``edit_file`` / ``delete_file``) —
  cùng kiểm đường dẫn, quy tắc không lưu, hạn mức, lịch sử, dấu xóa như tool MCP.
- Thử thuật toán (``/algo/*``): gọi hàm thuần (canonicalize, không lưu, fuzzy) — không ghi gì.
- Lỗi ``AppError`` → JSON chuẩn qua ``install_error_handlers`` (đã cài ở app).
"""

from __future__ import annotations

import base64
import json
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.gateway.deps import vfs_not_found_guard, workspace_db_path
from sandbox_kit_clone.manager.manager import Manager
from sandbox_kit_clone.vfs.core import MAX_REVISIONS_PER_FILE, VFS
from sandbox_kit_clone.vfs.fuzzy import fuzzy_replace
from sandbox_kit_clone.vfs.ignore import ignore_reason, is_ignored
from sandbox_kit_clone.vfs.paths import canonicalize_path
from sandbox_kit_clone.vfs.quota import used_bytes
from sandbox_kit_clone.vfs.schema import connect_workspace_db

admin_api_router = APIRouter(prefix="/admin/api", include_in_schema=False)

# File seed ghi nhãn workspace (tên không có cột trong schema thiết kế).
SEED_MANIFEST_NAME = "seed-manifest.json"

# Placeholder lịch sử của file lớn/nhị phân — không khôi phục được từ bản này.
_SKIPPED_PREFIX = "[full-content-skipped:"


def _manager(request: Request) -> Manager:
    return request.app.state.manager


@contextmanager
def _open_vfs(manager: Manager, workspace_id: str):
    """Mở VFS cho workspace đã tồn tại; luôn đóng connection khi xong."""
    vfs_not_found_guard(workspace_id, manager.settings)
    vfs = VFS(workspace_db_path(workspace_id, manager.settings), manager.settings)
    try:
        yield vfs
    finally:
        vfs.close()


def _read_manifest(manager: Manager) -> dict[str, dict]:
    """Nhãn workspace từ ``data/seed-manifest.json`` (nếu có): ``{workspace_id: {...}}``."""
    path = Path(manager.settings.data_dir) / SEED_MANIFEST_NAME
    try:
        items = json.loads(path.read_text(encoding="utf-8")).get("workspaces", [])
    except (OSError, ValueError, AttributeError):
        return {}
    return {item["workspace_id"]: item for item in items if isinstance(item, dict) and "workspace_id" in item}


def _workspace_summary(manager: Manager, workspace_id: str) -> dict:
    """Thống kê nhanh 1 workspace đọc thẳng từ DB dự án (không mở VFS đầy đủ)."""
    db_path = workspace_db_path(workspace_id, manager.settings)
    if not db_path.is_file():
        return {"missing_db": True}
    conn = connect_workspace_db(db_path)
    try:
        meta = conn.execute(
            "SELECT workspace_revision, conflict_policy FROM workspace_meta WHERE id = 1"
        ).fetchone()
        counts = conn.execute(
            "SELECT COUNT(*) AS n, SUM(storage_class = 'blob') AS blobs FROM files"
        ).fetchone()
        tombs = conn.execute("SELECT COUNT(*) FROM tombstones").fetchone()[0]
        return {
            "revision": meta["workspace_revision"] if meta else 0,
            "conflict_policy": meta["conflict_policy"] if meta else None,
            "file_count": counts["n"] or 0,
            "blob_count": counts["blobs"] or 0,
            "tombstone_count": tombs,
            "used_bytes": used_bytes(conn),
        }
    finally:
        conn.close()


def _sessions_of(manager: Manager, workspace_id: str) -> list[dict]:
    store = manager.store
    with store._lock:
        rows = store._conn.execute(
            "SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at", (workspace_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def _operations_of(manager: Manager, workspace_id: str, limit: int) -> list[dict]:
    store = manager.store
    with store._lock:
        rows = store._conn.execute(
            "SELECT * FROM operations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
            (workspace_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


# ------------------------------------------------------------------ đọc


@admin_api_router.get("/overview")
def overview(request: Request) -> dict:
    """Ngưỡng cấu hình + danh sách workspace kèm thống kê và nhãn seed."""
    manager = _manager(request)
    s = manager.settings
    labels = _read_manifest(manager)
    workspaces = []
    for ws in manager.store.list_workspaces():
        label = labels.get(ws["id"], {})
        sessions = _sessions_of(manager, ws["id"])
        workspaces.append(
            {
                **ws,
                "name": label.get("name"),
                "demonstrates": label.get("demonstrates"),
                "session_id": sessions[0]["session_id"] if sessions else None,
                **_workspace_summary(manager, ws["id"]),
            }
        )
    return {
        "settings": {
            "data_dir": str(Path(s.data_dir).resolve()),
            "inline_max_bytes": s.inline_max_bytes,
            "blob_sidecar_min_bytes": s.blob_sidecar_min_bytes,
            "workspace_quota_bytes": s.workspace_quota_bytes,
            "max_revisions_per_file": MAX_REVISIONS_PER_FILE,
        },
        "workspaces": workspaces,
    }


@admin_api_router.get("/workspaces/{workspace_id}")
def workspace_detail(workspace_id: str, request: Request) -> dict:
    """Chi tiết 1 workspace: meta, hạn mức, phiên, file, dấu xóa, sổ thao tác."""
    manager = _manager(request)
    with _open_vfs(manager, workspace_id) as vfs:
        conn = vfs._conn
        files = [
            {**dict(r), "ignored": is_ignored(r["path"])}
            for r in conn.execute(
                "SELECT path, size, sha256, rev, storage_class, blob_ref, synced_sha256,"
                " mtime, is_binary FROM files ORDER BY path"
            ).fetchall()
        ]
        tombstones = [
            dict(r) for r in conn.execute("SELECT * FROM tombstones ORDER BY rev DESC").fetchall()
        ]
        history_counts = {
            r["path"]: r["n"]
            for r in conn.execute(
                "SELECT path, COUNT(*) AS n FROM file_revisions GROUP BY path"
            ).fetchall()
        }
    for f in files:
        f["history_count"] = history_counts.get(f["path"], 0)
    label = _read_manifest(manager).get(workspace_id, {})
    return {
        "workspace": manager.store.get_workspace(workspace_id),
        "name": label.get("name"),
        "demonstrates": label.get("demonstrates"),
        "summary": _workspace_summary(manager, workspace_id),
        "quota_bytes": manager.settings.workspace_quota_bytes,
        "sessions": _sessions_of(manager, workspace_id),
        "files": files,
        "tombstones": tombstones,
        "operations": _operations_of(manager, workspace_id, 30),
    }


@admin_api_router.get("/workspaces/{workspace_id}/file")
def file_detail(workspace_id: str, request: Request, path: str = Query(...)) -> dict:
    """Metadata + nội dung (text / base64 / download_url) + lịch sử của 1 file."""
    manager = _manager(request)
    with _open_vfs(manager, workspace_id) as vfs:
        info = vfs.get_file_info(path)
        if info is None:
            raise AppError(ErrorCode.file_not_found, f"File không tồn tại: '{path}'")
        revisions = vfs.get_revisions(info["path"], limit=MAX_REVISIONS_PER_FILE)
        body: dict
        if info["size"] >= manager.settings.inline_max_bytes:
            body = {"encoding": "none"}
        else:
            data = vfs.read_file(info["path"])
            body = {"encoding": "base64", "content": base64.b64encode(data).decode("ascii")}
            if not info["is_binary"]:
                try:
                    body = {"encoding": "utf-8", "content": data.decode("utf-8")}
                except UnicodeDecodeError:
                    pass
    for rev in revisions:
        rev["restorable"] = not rev["patch"].startswith(_SKIPPED_PREFIX)
    return {
        **info,
        **body,
        "ignored": is_ignored(info["path"]),
        "download_url": f"/download/{workspace_id}?path={quote(info['path'])}",
        "revisions": revisions,
    }


# ------------------------------------------------------------------ ghi


class CreateWorkspaceBody(BaseModel):
    name: str = ""
    conflict_policy: str = "sandbox_wins"


class WriteBody(BaseModel):
    path: str
    content: str
    encoding: str = "utf-8"  # utf-8 | base64


class EditBody(BaseModel):
    path: str
    old_text: str
    new_text: str
    dry_run: bool = False


class MoveBody(BaseModel):
    src: str
    dst: str


class RestoreBody(BaseModel):
    path: str
    revision_id: int


@admin_api_router.post("/workspaces")
def create_workspace(body: CreateWorkspaceBody, request: Request) -> dict:
    """Tạo workspace qua Manager (ghi sổ thao tác như tool MCP)."""
    return _manager(request).create_workspace(body.name, body.conflict_policy)


@admin_api_router.put("/workspaces/{workspace_id}/file")
def write_file(workspace_id: str, body: WriteBody, request: Request) -> dict:
    if body.encoding == "base64":
        try:
            data = base64.b64decode(body.content, validate=True)
        except ValueError as exc:
            raise AppError(ErrorCode.invalid_request, "content base64 không hợp lệ") from exc
    elif body.encoding == "utf-8":
        data = body.content.encode("utf-8")
    else:
        raise AppError(ErrorCode.invalid_request, "encoding chỉ nhận utf-8 | base64")
    manager = _manager(request)
    if len(data) > manager.settings.inline_max_bytes:
        raise AppError(
            ErrorCode.invalid_request,
            f"File {len(data)} bytes vượt ngưỡng inline — dùng đường upload theo phần.",
        )
    with _open_vfs(manager, workspace_id) as vfs:
        return vfs.write_file(body.path, data)


@admin_api_router.post("/workspaces/{workspace_id}/edit")
def edit_file(workspace_id: str, body: EditBody, request: Request) -> dict:
    """Sửa khớp mờ; ``dry_run=true`` → chỉ trả nội dung sau sửa, không ghi."""
    with _open_vfs(_manager(request), workspace_id) as vfs:
        if not body.dry_run:
            return vfs.edit_file(body.path, body.old_text, body.new_text)
        data = vfs.read_file(body.path)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AppError(ErrorCode.invalid_request, "File không phải văn bản UTF-8") from exc
    result, used_fuzzy = fuzzy_replace(text, body.old_text, body.new_text)
    return {"dry_run": True, "used_fuzzy": used_fuzzy, "before": text, "after": result}


@admin_api_router.delete("/workspaces/{workspace_id}/file")
def delete_file(workspace_id: str, request: Request, path: str = Query(...)) -> dict:
    with _open_vfs(_manager(request), workspace_id) as vfs:
        return vfs.delete_file(path, origin="vfs")


@admin_api_router.post("/workspaces/{workspace_id}/move")
def move_file(workspace_id: str, body: MoveBody, request: Request) -> dict:
    """Đổi tên = ghi đích + xóa nguồn (nguồn để lại dấu xóa). Không áp cho file rời."""
    with _open_vfs(_manager(request), workspace_id) as vfs:
        src = canonicalize_path(body.src)
        dst = canonicalize_path(body.dst)
        if src == dst:
            raise AppError(ErrorCode.invalid_request, "Đường nguồn và đích trùng nhau")
        info = vfs.get_file_info(src)
        if info is None:
            raise AppError(ErrorCode.file_not_found, f"File không tồn tại: '{src}'")
        if info["storage_class"] == "blob":
            raise AppError(ErrorCode.invalid_request, "File rời (blob) chưa hỗ trợ đổi tên")
        if vfs.get_file_info(dst) is not None:
            raise AppError(ErrorCode.conflict, f"Đích đã tồn tại: '{dst}'")
        written = vfs.write_file(dst, vfs.read_file(src))
        deleted = vfs.delete_file(src, origin="vfs")
    return {"written": written, "deleted": deleted}


@admin_api_router.post("/workspaces/{workspace_id}/restore")
def restore_revision(workspace_id: str, body: RestoreBody, request: Request) -> dict:
    """Khôi phục nội dung một bản lịch sử (patch = toàn văn sau thay đổi) — tạo bản mới."""
    with _open_vfs(_manager(request), workspace_id) as vfs:
        target = next(
            (r for r in vfs.get_revisions(body.path, limit=MAX_REVISIONS_PER_FILE)
             if r["id"] == body.revision_id),
            None,
        )
        if target is None:
            raise AppError(ErrorCode.invalid_request, f"Không có bản lịch sử #{body.revision_id}")
        if target["patch"].startswith(_SKIPPED_PREFIX):
            raise AppError(ErrorCode.invalid_request, "Bản này không lưu toàn văn — không khôi phục được")
        return vfs.write_file(body.path, target["patch"])


# ------------------------------------------------------- thử thuật toán (không ghi)


class PathAlgoBody(BaseModel):
    path: str


class FuzzyAlgoBody(BaseModel):
    content: str
    old_text: str
    new_text: str


@admin_api_router.post("/algo/path")
def algo_path(body: PathAlgoBody) -> dict:
    """Chuẩn hóa đường dẫn + quy tắc không lưu — trả kết quả, lỗi trả dạng dữ liệu."""
    try:
        canonical = canonicalize_path(body.path)
    except AppError as exc:
        return {"input": body.path, "ok": False, **exc.to_payload()}
    reason = ignore_reason(canonical)
    out = {"input": body.path, "canonical": canonical, "changed": canonical != body.path,
           "ok": reason is None, "ignore_reason": reason}
    if reason is not None:
        out["error"] = {"code": ErrorCode.ignored_path.value, "message": f"Không lưu: {reason}"}
    return out


@admin_api_router.post("/algo/fuzzy")
def algo_fuzzy(body: FuzzyAlgoBody) -> dict:
    """Chạy fuzzy_replace trên văn bản tùy ý — cho biết mức khớp đã dùng."""
    try:
        result, used_fuzzy = fuzzy_replace(body.content, body.old_text, body.new_text)
    except AppError as exc:
        return {"ok": False, "level": 3, **exc.to_payload()}
    return {"ok": True, "used_fuzzy": used_fuzzy, "level": 2 if used_fuzzy else 1, "result": result}
