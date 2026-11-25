"""Workspace Sync — đẩy thay đổi VFS → sandbox trước mỗi lệnh, nhận thay đổi sandbox → VFS sau
(design-01 §6.2, system-design §7.2).

Mô hình checkout/check-in: **VFS = kho (source of truth), sandbox = working copy**. Push =
checkout (đẩy kho ra sandbox); Pull = check-in có kiểm soát (nhận thay đổi của agent về kho).
Baseline tin cậy là ``synced_sha256`` TỪNG file — KHÔNG dùng watermark vì nó cố tình lag.

Trình tự một lần push (watermark = ``sync_state.last_synced_revision``):

1. ``R = workspace_revision``. ``R == watermark`` và trạng thái ``synced`` → bỏ qua (đường nóng).
2. Tập cần gửi: file ``rev > watermark`` hoặc ``synced_sha256 != sha256`` + dấu xóa ``rev > watermark``
   (``full=True`` → toàn bộ, dùng khi muốn đồng bộ lại từ đầu — sửa chữa, VFS thắng, BỎ QUA guard).
3. **Guard xung đột** (chỉ khi ``full=False``): listing sandbox qua ``ListFiles``; put path mà
   sandbox đang giữ nội dung khác ``synced_sha256`` (hoặc delete path mà file trong sandbox đã bị
   sửa khác tombstone) = sandbox có thay đổi chưa về kho mà sắp bị đè. Chính sách ``error`` →
   chặn TRƯỚC KHI gửi bất cứ gì (``AppError(conflict)``); ``sandbox_wins`` → bỏ các path đó khỏi
   lượt push (bản sandbox thắng, sẽ về kho qua pull).
4. Gửi qua RPC ``SyncFiles``; trình thực thi xác nhận TỪNG file (đường dẫn + sha256 đã ghi).
5. Đủ 100% xác nhận → Tx-A (DB dự án): ``synced_sha256``; Tx-B (DB hệ thống): watermark = R,
   ``status = synced``. Thiếu xác nhận → ``status = stale``, giữ watermark cũ → lỗi
   ``sync_unavailable``: lệnh KHÔNG được chạy; lần sau tính lại (trùng lặp vô hại).

Pull-back (``pull``): listing sandbox + map VFS → phân loại theo ``synced_sha256`` — chỉ sandbox
đổi → nhận về (update/import); sandbox xóa file đã push → xóa kho (tombstone origin="sandbox");
hai phía cùng đổi (hoặc xóa-vs-sửa) → XUNG ĐỘT: ``error`` → không áp dụng gì cả, ``sandbox_wins``
→ nhận đè bản sandbox. Path bị ignore không nhận về. Pull KHÔNG đụng sync_state/watermark — file
nhận về có ``synced == sha`` nên ``push_candidates`` không chọn lại (không ping-pong).

Không giữ transaction DB trong lúc chờ mạng (§2.8): nội dung đọc từng file khi gửi, ghi DB sau khi
nhận xác nhận. Đường dự phòng ``provider.sync_files`` (put_archive) chưa làm — agent không phản hồi
thì báo lỗi luôn.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections.abc import Iterator
from pathlib import Path

from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.manager.exec_client import DeleteOp, ExecClient, PutOp
from sandbox_kit_clone.system.store import SystemStore
from sandbox_kit_clone.vfs.core import VFS
from sandbox_kit_clone.vfs.ignore import IGNORED_DIR_NAMES, ignore_reason

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

        # Guard trước push (W3): sandbox có thay đổi chưa về kho mà sắp bị đè? (full = sửa chữa,
        # VFS thắng — bỏ qua guard). Lỗi kênh gRPC ở đây nổi nguyên trạng, trạng thái không đổi.
        guarded: list[dict] = []
        if not full:
            listing = {
                e["path"]: e["sha256"]
                for e in client.list_files(exclude_dirs=sorted(IGNORED_DIR_NAMES), with_sha256=True)
            }
            for path in put_paths:
                info = vfs.get_file_info(path)
                synced = (info or {}).get("synced_sha256") or ""
                sb_sha = listing.get(path)
                if sb_sha is not None and sb_sha != synced:  # file mới (chưa có trong sandbox) → không guard
                    guarded.append({"path": path, "kind": "put"})
            for path in del_paths:
                sb_sha = listing.get(path)
                tomb = vfs.tombstone_info(path)
                if sb_sha is not None and tomb is not None and sb_sha != tomb["sha256"]:
                    guarded.append({"path": path, "kind": "delete"})  # xóa-vs-sửa
        if guarded:
            if vfs.conflict_policy != "sandbox_wins":
                raise AppError(
                    ErrorCode.conflict,
                    f"Sandbox có {len(guarded)} thay đổi chưa về kho mà push sắp đè"
                    " — pull-back trước hoặc đổi chính sách xung đột",
                    details={"guarded": guarded},
                )
            # sandbox_wins: bản sandbox thắng — không gửi các path bị guard (sẽ về kho qua pull).
            g_puts = {g["path"] for g in guarded if g["kind"] == "put"}
            g_dels = {g["path"] for g in guarded if g["kind"] == "delete"}
            put_paths = [p for p in put_paths if p not in g_puts]
            del_paths = [p for p in del_paths if p not in g_dels]
            if not put_paths and not del_paths:
                return {
                    "pushed": False,
                    "skipped": False,
                    "guarded": guarded,
                    "revision": revision,
                    "put": 0,
                    "deleted": 0,
                    "bytes": 0,
                    "duration_ms": 0,
                }

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
            "guarded": guarded,
        }


def _conflict(path: str, kind: str, sb_sha: str, vfs_sha: str) -> dict:
    return {"path": path, "kind": kind, "sandbox_sha256": sb_sha, "vfs_sha256": vfs_sha}


def pull(
    *,
    store: SystemStore,
    vfs: VFS,
    client: ExecClient,
    sandbox_id: str,
    workspace_id: str,
    policy: str,
) -> dict:
    """Check-in có kiểm soát: nhận thay đổi sandbox về kho (W3 pull-back); trả tóm tắt.

    Baseline tin cậy = ``synced_sha256`` từng file (KHÔNG dùng watermark — nó cố tình lag).
    Phân loại (sb = sandbox, kho = VFS):

    - Có ở cả hai, ``sb_sha == kho_sha``: nội dung đã bằng nhau — ``synced`` lệch thì chỉ đánh
      dấu lại (kind ``mark``).
    - Có ở cả hai, ``sb_sha == synced``: kho đi trước — bỏ qua, push sẽ xử lý.
    - Có ở cả hai, ``kho_sha == synced``: chỉ sandbox đổi → nhận về (kind ``update``).
    - Có ở cả hai, cả hai khác ``synced``: XUNG ĐỘT ``modify_vs_modify``.
    - Chỉ sandbox có: file mới của agent → nhận về (kind ``import`` — không đè gì của kho).
    - Kho có (đã từng push) mà sandbox vắng: ``kho_sha == synced`` → sandbox đã xóa → xóa kho
      (kind ``delete``, tombstone origin="sandbox"); khác → XUNG ĐỘT ``delete_vs_modify``.

    Chính sách xung đột: ``error`` + có conflict → KHÔNG áp dụng gì cả (kể cả phần không conflict),
    raise ``AppError(conflict)``; ``sandbox_wins`` → conflict cũng xử theo bản sandbox (nhận đè /
    xóa kho). Path thuộc vùng ignore không nhận về. Lỗi kênh gRPC (``agent_unavailable``) nổi
    nguyên trạng. KHÔNG đụng sync_state/watermark — file nhận về có ``synced == sha`` nên
    ``push_candidates`` không chọn lại (không ping-pong).
    """
    started = time.monotonic()
    with _sandbox_lock(sandbox_id):
        listing = {
            e["path"]: e["sha256"]
            for e in client.list_files(exclude_dirs=sorted(IGNORED_DIR_NAMES), with_sha256=True)
        }
        vfs_info: dict[str, dict] = {}
        for item in vfs.list_files():
            info = vfs.get_file_info(item["path"])
            if info is not None:
                vfs_info[item["path"]] = info

        marks: list[tuple[str, str]] = []
        to_pull: list[str] = []
        pull_kinds: dict[str, str] = {}
        to_delete: list[str] = []
        conflicts: list[dict] = []
        skipped_ignored: list[str] = []

        for path in sorted(set(listing) | set(vfs_info)):
            info = vfs_info.get(path)
            if path in listing and info is not None:
                sb_sha, vfs_sha = listing[path], info["sha256"]
                synced = info["synced_sha256"] or ""
                if sb_sha == vfs_sha:
                    if synced != vfs_sha:
                        marks.append((path, vfs_sha))  # nội dung đã bằng nhau, chỉ đánh dấu
                elif sb_sha == synced:
                    continue  # kho đi trước — push sẽ xử lý
                elif vfs_sha == synced:
                    to_pull.append(path)
                    pull_kinds[path] = "update"  # chỉ sandbox đổi → nhận về
                else:
                    conflicts.append(_conflict(path, "modify_vs_modify", sb_sha, vfs_sha))
            elif path in listing:
                if ignore_reason(path) is not None:  # thư viện/cache/build — không vào kho
                    skipped_ignored.append(path)
                    continue
                to_pull.append(path)
                pull_kinds[path] = "import"  # file mới của agent
            else:  # chỉ kho có, sandbox vắng
                vfs_sha = info["sha256"]
                synced = info["synced_sha256"] or ""
                if synced and vfs_sha == synced:
                    to_delete.append(path)  # sandbox đã xóa file đã push → xóa kho
                elif synced:
                    conflicts.append(_conflict(path, "delete_vs_modify", "", vfs_sha))
                # synced rỗng: chưa từng push → sandbox chưa từng có, bỏ qua

        if conflicts and policy != "sandbox_wins":
            # chính sách 'error': không nhận gì về kho — kể cả phần không conflict.
            raise AppError(
                ErrorCode.conflict,
                f"Pull-back phát hiện {len(conflicts)} xung đột với kho"
                " (chính sách 'error') — không nhận gì về",
                details={"conflicts": conflicts},
            )
        for c in conflicts:  # sandbox_wins: xung đột cũng xử theo bản sandbox
            if c["kind"] == "modify_vs_modify":
                to_pull.append(c["path"])
                pull_kinds[c["path"]] = "update"
            else:
                to_delete.append(c["path"])
        to_pull.sort()
        to_delete.sort()

        applied: list[dict] = []
        failures: list[dict] = []
        total_bytes = 0

        if marks:
            vfs.set_synced_many(marks)
            applied.extend({"path": p, "kind": "mark"} for p, _ in marks)

        if to_pull:
            pulled = {pf.path: pf for pf in client.pull(to_pull)}
            for path in to_pull:
                pf = pulled.get(path)
                if pf is None:
                    failures.append({"path": path, "error": "agent không trả file này"})
                    continue
                if pf.error:
                    failures.append({"path": path, "error": pf.error})
                    continue
                content = b"".join(pf.chunks())
                if hashlib.sha256(content).hexdigest() != pf.sha256:
                    failures.append({"path": path, "error": "sha256 nội dung nhận về lệch với agent"})
                    continue  # kiểm sha TRƯỚC khi ghi
                vfs.write_file(path, content)  # cùng nội dung vẫn no-op, set synced bên dưới
                vfs.set_synced_sha(path, pf.sha256)
                applied.append({"path": path, "kind": pull_kinds[path]})
                total_bytes += len(content)

        for path in to_delete:
            try:
                vfs.delete_file(path, origin="sandbox")
            except AppError as exc:
                if exc.code is not ErrorCode.file_not_found:
                    raise  # file đã biến mất nơi khác giữa lúc phân loại và lúc áp dụng — vô hại
                failures.append({"path": path, "error": str(exc)})
                continue
            applied.append({"path": path, "kind": "delete"})

        return {
            "pulled": bool(applied),
            "applied": applied,
            "conflicts": conflicts,
            "failures": failures,
            "skipped_ignored": skipped_ignored,
            "bytes": total_bytes,
            "duration_ms": int((time.monotonic() - started) * 1000),
        }


def pending(store: SystemStore, vfs: VFS, sandbox_id: str | None) -> dict:
    """Số thay đổi chưa vào sandbox (cho ``sync_status``)."""
    state = store.get_sync_state(sandbox_id) if sandbox_id else None
    watermark = state["last_synced_revision"] if state else 0
    puts, dels = vfs.push_candidates(watermark)
    return {"pending_put": len(puts), "pending_delete": len(dels), "watermark": watermark}
