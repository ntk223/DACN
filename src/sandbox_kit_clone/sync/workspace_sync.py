"""Workspace Sync — đẩy thay đổi VFS → sandbox trước mỗi lệnh (design-01 §6.2, system-design §7.2).

Trình tự một lần push (watermark = ``sync_state.last_synced_revision``):

1. ``R = workspace_revision``. ``R == watermark`` và trạng thái ``synced`` → bỏ qua (đường nóng).
2. Tập cần gửi: file ``rev > watermark`` hoặc ``synced_sha256 != sha256`` + dấu xóa ``rev > watermark``
   (``full=True`` → toàn bộ, dùng khi muốn đồng bộ lại từ đầu).
3. Gửi qua RPC ``SyncFiles``; trình thực thi xác nhận TỪNG file (đường dẫn + sha256 đã ghi).
4. Đủ 100% xác nhận → Tx-A (DB dự án): ``synced_sha256``; Tx-B (DB hệ thống): watermark = R,
   ``status = synced``. Thiếu xác nhận → ``status = stale``, giữ watermark cũ → lỗi
   ``sync_unavailable``: lệnh KHÔNG được chạy; lần sau tính lại (trùng lặp vô hại).

Không giữ transaction DB trong lúc chờ mạng (§2.8): nội dung đọc từng file khi gửi, ghi DB sau khi
nhận xác nhận. Đường dự phòng ``provider.sync_files`` (put_archive) chưa làm — agent không phản hồi
thì báo lỗi luôn.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.manager.exec_client import DeleteOp, ExecClient, PutOp
from sandbox_kit_clone.system.store import SystemStore
from sandbox_kit_clone.vfs.core import VFS

_BLOB_READ = 1024 * 1024

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _sandbox_lock(sandbox_id: str) -> threading.Lock:
    """Một lần push tại một thời điểm cho mỗi sandbox (hai lệnh chạy song song không đẩy chồng)."""
    with _locks_guard:
        return _locks.setdefault(sandbox_id, threading.Lock())


def _blob_chunks(path: Path) -> Iterator[bytes]:
    with open(path, "rb") as f:
        yield from iter(lambda: f.read(_BLOB_READ), b"")


def _put_ops(vfs: VFS, paths: list[str], skipped: list[str]) -> Iterator[PutOp]:
    """Sinh PutOp LƯỜI: mỗi file đọc nội dung + sha cùng lúc ngay trước khi gửi."""
    for path in paths:
        item = vfs.read_for_push(path)
        if item is None:  # bị xóa giữa lúc tính và lúc gửi → dấu xóa sẽ đi ở lần sau
            skipped.append(path)
            continue
        if item["blob_path"] is not None:
            blob = item["blob_path"]
            yield PutOp(path, item["sha256"], item["size"], lambda b=blob: _blob_chunks(b))
        else:
            data = item["content"]
            yield PutOp(path, item["sha256"], item["size"], lambda d=data: iter((d,)))


def push(
    *,
    store: SystemStore,
    vfs: VFS,
    client: ExecClient,
    sandbox_id: str,
    workspace_id: str,
    full: bool = False,
) -> dict:
    """Đẩy thay đổi vào sandbox; trả tóm tắt. Không đủ xác nhận → ``AppError(sync_unavailable)``."""
    with _sandbox_lock(sandbox_id):
        state = store.get_sync_state(sandbox_id)
        watermark = state["last_synced_revision"] if state else 0
        revision = vfs.revision
        if not full and state is not None and state["status"] == "synced" and revision == watermark:
            return {"pushed": False, "skipped": True, "revision": revision, "put": 0, "deleted": 0}

        put_paths, del_paths = vfs.push_candidates(watermark, full=full)
        if not put_paths and not del_paths:
            store.upsert_sync_state(sandbox_id, workspace_id, last_synced_revision=revision, status="synced")
            return {"pushed": True, "skipped": False, "revision": revision, "put": 0, "deleted": 0,
                    "bytes": 0, "duration_ms": 0}

        skipped: list[str] = []

        def ops() -> Iterator:
            yield from _put_ops(vfs, put_paths, skipped)
            for path in del_paths:
                yield DeleteOp(path)

        store.upsert_sync_state(sandbox_id, workspace_id, status="syncing")
        try:
            reply = client.sync(ops())
        except AppError:
            store.upsert_sync_state(sandbox_id, workspace_id, status="stale")
            raise

        acked_puts = [(a.path, a.sha256) for a in reply.acks if a.ok and a.op == 0]
        acked_dels = [a.path for a in reply.acks if a.ok and a.op == 1]
        failures = [{"path": a.path, "op": "put" if a.op == 0 else "delete", "error": a.error}
                    for a in reply.acks if not a.ok]
        expected = len(put_paths) - len(skipped) + len(del_paths)
        vfs.set_synced_many(acked_puts)  # Tx-A: kể cả khi thiếu — file đã ghi là đã ghi thật
        if failures or len(reply.acks) != expected:
            store.upsert_sync_state(sandbox_id, workspace_id, status="stale")
            raise AppError(
                ErrorCode.sync_unavailable,
                f"Đồng bộ vào sandbox chưa xong ({len(acked_puts) + len(acked_dels)}/{expected} xác nhận)"
                " — lệnh KHÔNG được chạy; thử lại sẽ gửi lại phần còn thiếu",
                details={"failures": failures[:20]},
            )
        # Tx-B: mốc đồng bộ chỉ tiến khi sandbox xác nhận đủ (§2.7).
        store.upsert_sync_state(sandbox_id, workspace_id, last_synced_revision=revision, status="synced")
        return {
            "pushed": True,
            "skipped": False,
            "revision": revision,
            "put": len(acked_puts),
            "deleted": len(acked_dels),
            "bytes": reply.bytes_written,
            "duration_ms": reply.duration_ms,
        }


def pending(store: SystemStore, vfs: VFS, sandbox_id: str | None) -> dict:
    """Số thay đổi chưa vào sandbox (cho ``sync_status``)."""
    state = store.get_sync_state(sandbox_id) if sandbox_id else None
    watermark = state["last_synced_revision"] if state else 0
    puts, dels = vfs.push_candidates(watermark)
    return {"pending_put": len(puts), "pending_delete": len(dels), "watermark": watermark}
