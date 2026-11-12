"""Kiểm thử W1.4: upload/download theo phần qua HTTP + GC staging (dùng VFS thật W1.3)."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.gateway import (
    CHUNK_SIZE,
    download_router,
    gc_staging,
    install_error_handlers,
    upload_router,
)
from sandbox_kit_clone.gateway.deps import _SESSIONS, get_vfs
from sandbox_kit_clone.vfs.schema import init_workspace_db

# Gate giữ nguyên từ giai đoạn W1.3 làm song song: module có mặt → không skip.
pytest.importorskip("sandbox_kit_clone.vfs.core", reason="W1.3 (vfs.core) chưa merge")
pytest.importorskip("sandbox_kit_clone.vfs.blob", reason="W1.3 (vfs.blob) chưa merge")

WS_ID = "ws-upload-test"


def _make_app(settings: Settings) -> FastAPI:
    app = FastAPI()
    app.include_router(upload_router)
    app.include_router(download_router)
    install_error_handlers(app)
    app.state.settings = settings
    return app


@pytest.fixture()
def env(tmp_path: Path) -> tuple[TestClient, Settings]:
    """App test + Settings dữ liệu trong tmp_path; workspace DB được tạo sẵn như manager."""
    settings = Settings(data_dir=str(tmp_path / "data"))
    init_workspace_db(Path(settings.data_dir) / "workspaces" / f"{WS_ID}.sqlite").close()
    return TestClient(_make_app(settings)), settings


def _init_upload(client: TestClient, path: str, size: int, sha256: str | None = None) -> str:
    res = client.post(
        "/upload",
        json={"workspace_id": WS_ID, "path": path, "size": size, "sha256": sha256},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


# ------------------------------------------------------------------- 1. init


def test_init_upload_returns_token_and_staging_dir(env):
    client, settings = env
    res = client.post(
        "/upload", json={"workspace_id": WS_ID, "path": "docs/big.bin", "size": 1024}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["token"]
    assert body["upload_url"] == f"/upload/{body['token']}"
    assert body["chunk_size"] == CHUNK_SIZE
    assert body["state"] == "ready"
    assert (Path(settings.data_dir) / "staging" / "upload" / body["token"]).is_dir()


def test_init_upload_unknown_workspace_404(env):
    client, _ = env
    res = client.post(
        "/upload", json={"workspace_id": "ghost", "path": "a.bin", "size": 10}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "workspace_not_found"


# ------------------------------------------------------- 2. file nhỏ → 'vfs'


def test_upload_small_3_chunks_storage_vfs(env):
    client, settings = env
    size = 5 * 1024 * 1024
    token = _init_upload(client, "docs/medium.bin", size)
    chunks = [os.urandom(2 * 1024 * 1024), os.urandom(2 * 1024 * 1024), os.urandom(1024 * 1024)]
    for i, data in enumerate(chunks):
        res = client.put(f"/upload/{token}", params={"chunk": i}, content=data)
        assert res.status_code == 200
        assert res.json() == {"received": i, "bytes": len(data)}

    hasher = hashlib.sha256()
    for data in chunks:
        hasher.update(data)
    sha = hasher.hexdigest()

    res = client.post(f"/upload/{token}/complete")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["storage"] == "vfs"
    assert body["sha256"] == sha
    assert body["size"] == size
    assert body["workspace_id"] == WS_ID
    assert body["path"] == "docs/medium.bin"
    assert isinstance(body["rev"], int)

    # Đọc ngược bằng VFS thật: bytes khớp, sha khớp, storage_class đúng.
    info = get_vfs(WS_ID, settings).get_file_info("docs/medium.bin")
    assert info is not None and info["storage_class"] == "vfs"
    assert info["sha256"] == sha and info["size"] == size
    assert get_vfs(WS_ID, settings).read_file("docs/medium.bin") == b"".join(chunks)

    # Download stream về đúng bytes + header sha.
    down = client.get(f"/download/{WS_ID}", params={"path": "docs/medium.bin"})
    assert down.status_code == 200
    assert down.headers["x-file-sha256"] == sha
    assert hashlib.sha256(down.content).hexdigest() == sha

    # PUT sau khi complete → 404 (phiên đã đóng).
    assert client.put(f"/upload/{token}", params={"chunk": 0}, content=b"x").status_code == 404


# ------------------------------------------------------ 3. file lớn → 'blob'


def test_upload_large_33mb_storage_blob_and_download_stream(env):
    client, settings = env
    size = 33 * 1024 * 1024
    token = _init_upload(client, "media/large.bin", size)
    chunks = [os.urandom(11 * 1024 * 1024) for _ in range(3)]
    hasher = hashlib.sha256()
    for i, data in enumerate(chunks):
        hasher.update(data)
        res = client.put(f"/upload/{token}", params={"chunk": i}, content=data)
        assert res.status_code == 200
    sha = hasher.hexdigest()

    res = client.post(f"/upload/{token}/complete")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["storage"] == "blob"
    assert body["sha256"] == sha
    assert body["size"] == size

    # Row files: content NULL, blob_ref = sha; sidecar tồn tại đúng sha + kích thước.
    # (Vị trí sidecar do VFS/BlobStore sở hữu: vfs.blobs.path_of — test không hardcode layout.)
    db = sqlite3.connect(Path(settings.data_dir) / "workspaces" / f"{WS_ID}.sqlite")
    try:
        row = db.execute(
            "SELECT content, storage_class, blob_ref, size FROM files WHERE path = ?",
            ("media/large.bin",),
        ).fetchone()
    finally:
        db.close()
    assert row[0] is None
    assert row[1] == "blob"
    assert row[2] == sha
    assert row[3] == size

    sidecar = get_vfs(WS_ID, settings).blobs.path_of(sha)
    assert sidecar.is_file()
    assert sidecar.stat().st_size == size

    # GET /download stream về đúng bytes (hash lại khớp) + header sha.
    down = client.get(f"/download/{WS_ID}", params={"path": "media/large.bin"})
    assert down.status_code == 200
    assert down.headers["x-file-sha256"] == sha
    assert hashlib.sha256(down.content).hexdigest() == sha
    assert len(down.content) == size


# --------------------------------------------------------- 4. thiếu chunk


def test_complete_with_missing_middle_chunk_400(env):
    client, _ = env
    token = _init_upload(client, "gap.bin", 4 * CHUNK_SIZE)
    client.put(f"/upload/{token}", params={"chunk": 0}, content=b"A" * 1024)
    client.put(f"/upload/{token}", params={"chunk": 1}, content=b"B" * 1024)
    client.put(f"/upload/{token}", params={"chunk": 3}, content=b"C" * 1024)

    res = client.post(f"/upload/{token}/complete")
    assert res.status_code == 400
    payload = res.json()["error"]
    assert payload["code"] == "invalid_request"
    assert "thiếu chunk 2" in payload["message"]


# ------------------------------------------------- 5. X-Chunk-Sha256 header


def test_chunk_sha256_header_wrong_then_right(env):
    client, _ = env
    token = _init_upload(client, "hashed/chunk.bin", 2048)
    data = b"payload-chunk" * 100

    wrong = client.put(
        f"/upload/{token}",
        params={"chunk": 0},
        content=data,
        headers={"X-Chunk-Sha256": "0" * 64},
    )
    assert wrong.status_code == 400
    assert wrong.json()["error"]["code"] == "invalid_request"
    assert "sha mismatch" in wrong.json()["error"]["message"]

    good = client.put(
        f"/upload/{token}",
        params={"chunk": 0},
        content=data,
        headers={"X-Chunk-Sha256": hashlib.sha256(data).hexdigest()},
    )
    assert good.status_code == 200

    assert client.post(f"/upload/{token}/complete").status_code == 200


# ------------------------------------- 6. sha tổng lệch → 409, staging còn


def test_complete_wrong_total_sha_409_keeps_staging_then_retry(env):
    client, settings = env
    content = b"final-content"
    good_sha = hashlib.sha256(content).hexdigest()
    token = _init_upload(client, "sha-mismatch.bin", len(content), sha256=good_sha)
    client.put(f"/upload/{token}", params={"chunk": 0}, content=b"WRONG")

    res = client.post(f"/upload/{token}/complete")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "conflict"
    assert res.json()["error"]["message"] == "sha256 tổng lệch"

    # Staging còn nguyên; status vẫn thấy chunk.
    assert (Path(settings.data_dir) / "staging" / "upload" / token).is_dir()
    status = client.get(f"/upload/{token}/status")
    assert status.status_code == 200
    assert status.json()["chunks_received"] == 1
    assert status.json()["completed"] is False

    # Client retry: đè chunk đúng → complete thành công.
    client.put(f"/upload/{token}", params={"chunk": 0}, content=content)
    retry = client.post(f"/upload/{token}/complete")
    assert retry.status_code == 200
    assert retry.json()["sha256"] == good_sha
    assert retry.json()["storage"] == "vfs"


# ------------------------------------------------------------ 7. hủy phiên


def test_cancel_then_complete_404(env):
    client, settings = env
    token = _init_upload(client, "cancelled.bin", 1024)
    client.put(f"/upload/{token}", params={"chunk": 0}, content=b"x")

    res = client.delete(f"/upload/{token}")
    assert res.status_code == 200
    assert res.json() == {"cancelled": True}
    assert not (Path(settings.data_dir) / "staging" / "upload" / token).exists()

    after = client.post(f"/upload/{token}/complete")
    assert after.status_code == 404
    assert after.json()["error"]["code"] == "invalid_request"


def test_unknown_token_404_invalid_request(env):
    client, _ = env
    res = client.put("/upload/deadbeef00", params={"chunk": 0}, content=b"x")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "invalid_request"


# ------------------------------------------------------- 8. status đếm chunk


def test_status_counts_chunks(env):
    client, _ = env
    token = _init_upload(client, "status.bin", 4096)

    empty = client.get(f"/upload/{token}/status").json()
    assert empty == {
        "token": token,
        "chunks_received": 0,
        "completed": False,
        "declared_size": 4096,
    }

    for i in range(3):
        client.put(f"/upload/{token}", params={"chunk": i}, content=bytes([i]) * 10)
    assert client.get(f"/upload/{token}/status").json()["chunks_received"] == 3


# ------------------------------------------------------------- 9. GC staging


def test_gc_staging_removes_only_expired_tokens(env):
    client, settings = env
    token_old = _init_upload(client, "old.bin", 1024)
    client.put(f"/upload/{token_old}", params={"chunk": 0}, content=b"old-data")
    token_new = _init_upload(client, "new.bin", 1024)
    client.put(f"/upload/{token_new}", params={"chunk": 0}, content=b"new-data")

    old_dir = Path(settings.data_dir) / "staging" / "upload" / token_old
    expired = time.time() - 25 * 3600  # quá hạn 24h
    os.utime(old_dir, (expired, expired))

    removed = gc_staging(settings, now=time.time())
    assert token_old in removed
    assert token_new not in removed
    assert not old_dir.exists()
    assert (Path(settings.data_dir) / "staging" / "upload" / token_new).is_dir()

    # Registry: token cũ bị gỡ; token mới vẫn nhận thêm chunk bình thường.
    assert token_old not in _SESSIONS
    ok = client.put(f"/upload/{token_new}", params={"chunk": 1}, content=b"more")
    assert ok.status_code == 200


# --------------------------------------------------------------- 10. quota


def test_quota_exceeded_413(tmp_path):
    settings = Settings(data_dir=str(tmp_path / "data"), workspace_quota_bytes=1000)
    init_workspace_db(Path(settings.data_dir) / "workspaces" / f"{WS_ID}.sqlite").close()
    client = TestClient(_make_app(settings))

    res = client.post(
        "/upload", json={"workspace_id": WS_ID, "path": "big.bin", "size": 2000}
    )
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "quota_exceeded"


# ------------------------------------- 11. (bổ sung) lỗi bất ngờ → 500 chuẩn


def test_unexpected_error_returns_internal_error_without_traceback(tmp_path):
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("nổ rồi")

    client = TestClient(app, raise_server_exceptions=False)
    res = client.get("/boom")
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "internal_error"
    assert "nổ rồi" not in res.text
