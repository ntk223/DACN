"""Kiểm thử W1.3 — VFS core (gate A7): conformance 18 test.

Mỗi test dựng workspace riêng trong ``tmp_path`` với ``Settings`` riêng; DB được
kiểm tra trực tiếp qua sqlite3 khi cần xác minh Storage-layout (content NULL,
tombstone, trần 20 patch).
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import unicodedata

import pytest

from sandbox_kit_clone.config import Settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.vfs.blob import BlobStore
from sandbox_kit_clone.vfs.core import VFS
from sandbox_kit_clone.vfs.fuzzy import fuzzy_replace
from sandbox_kit_clone.vfs.paths import canonicalize_path


@pytest.fixture()
def make_vfs(tmp_path):
    """Factory dựng VFS trên workspace riêng; đóng hết connection khi xong test."""
    stores: list[VFS] = []

    def _make(**settings_kwargs) -> VFS:
        store = VFS(tmp_path / "ws.sqlite", Settings(**settings_kwargs))
        stores.append(store)
        return store

    yield _make
    for store in stores:
        store.close()


def open_db(tmp_path) -> sqlite3.Connection:
    """Mở connection đọc trực tiếp workspace DB (xác minh layout bên dưới VFS)."""
    conn = sqlite3.connect(tmp_path / "ws.sqlite")
    conn.row_factory = sqlite3.Row
    return conn


# ------------------------------------------------------- 1. write → read roundtrip


def test_write_read_roundtrip_text_and_binary(make_vfs):
    vfs = make_vfs()
    text = "Xin chào thế giới! — Tiếng Việt có dấu đầy đủ: àáạảã èéẹẻẽ ỷỪỰ"

    result = vfs.write_file("docs/ghi-chú.md", text)
    assert result["size"] == len(text.encode("utf-8"))
    assert result["storage_class"] == "vfs"
    assert vfs.read_file("docs/ghi-chú.md").decode("utf-8") == text

    info = vfs.get_file_info("docs/ghi-chú.md")
    assert info is not None
    assert info["is_binary"] == 0
    assert info["blob_ref"] is None
    assert info["synced_sha256"] is None  # chưa từng sync (W3)
    assert info["mtime"]

    binary = b"\x00\x01\x02BIN\x00ARY\xff"
    vfs.write_file("data/blob.bin", binary)
    assert vfs.read_file("data/blob.bin") == binary
    assert vfs.get_file_info("data/blob.bin")["is_binary"] == 1


def test_same_sha_write_is_noop(make_vfs):
    vfs = make_vfs()
    first = vfs.write_file("a.txt", "giống nhau")
    assert first.get("noop", False) is False

    second = vfs.write_file("a.txt", "giống nhau")
    assert second["noop"] is True
    assert second["rev"] == first["rev"] == 1
    assert second["sha256"] == first["sha256"]

    # Không bump revision, không thêm history.
    assert vfs.revision == 1
    assert vfs.get_revisions("a.txt") == []


def test_revision_bumps_per_change(make_vfs):
    vfs = make_vfs()
    assert vfs.revision == 0

    assert vfs.write_file("a.txt", "v1")["rev"] == 1
    assert vfs.write_file("a.txt", "v2")["rev"] == 2
    assert vfs.write_file("b.txt", "v3")["rev"] == 3

    assert vfs.revision == 3
    assert vfs.get_file_info("a.txt")["rev"] == 2
    assert vfs.get_file_info("b.txt")["rev"] == 3
    # workspace_revision đồng bộ với files.rev (bump trong cùng transaction).
    assert vfs.get_file_info("b.txt")["rev"] == vfs.revision


def test_edit_fuzzy_whitespace_and_indent(make_vfs):
    vfs = make_vfs()
    content = (
        "def main():\n"
        "    print('hello')\n"
        "    return 0\n"
        "\n"
        "if __name__ == '__main__':\n"
        "    main()\n"
    )
    vfs.write_file("app.py", content)

    # old_text lệch indent (không có) + khoảng trắng kép — vẫn phải khớp fuzzy.
    result = vfs.edit_file("app.py", "print('hello')\nreturn  0", "print('goodbye')\nreturn 1")
    assert result["used_fuzzy"] is True
    expected = (
        "def main():\n"
        "    print('goodbye')\n"
        "    return 1\n"
        "\n"
        "if __name__ == '__main__':\n"
        "    main()\n"
    )
    assert vfs.read_file("app.py").decode("utf-8") == expected


def test_edit_exact_match_not_fuzzy(make_vfs):
    vfs = make_vfs()
    vfs.write_file("a.txt", "alpha\nbeta\ngamma\n")
    result = vfs.edit_file("a.txt", "beta", "BETA")
    assert result["used_fuzzy"] is False
    assert vfs.read_file("a.txt").decode("utf-8") == "alpha\nBETA\ngamma\n"


def test_fuzzy_replace_unit_levels(make_vfs):
    # Mức 1: khớp chính xác đúng 1 lần.
    out, used_fuzzy = fuzzy_replace("one two three", "two", "TWO")
    assert (out, used_fuzzy) == ("one TWO three", False)


def test_edit_fuzzy_unresolvable_raises(make_vfs):
    vfs = make_vfs()
    vfs.write_file("a.txt", "x = 1\nx = 1\n")

    # Khớp 2 nơi (cả fuzzy theo dòng) → lỗi.
    with pytest.raises(AppError) as exc_info:
        vfs.edit_file("a.txt", "x = 1", "x = 2")
    assert exc_info.value.code is ErrorCode.invalid_request

    # Không tìm thấy → lỗi.
    with pytest.raises(AppError) as exc_info:
        vfs.edit_file("a.txt", "không tồn tại trong file", "y")
    assert exc_info.value.code is ErrorCode.invalid_request

    # old_text rỗng → lỗi.
    with pytest.raises(AppError) as exc_info:
        vfs.edit_file("a.txt", "", "y")
    assert exc_info.value.code is ErrorCode.invalid_request

    # File không đổi sau các lỗi.
    assert vfs.read_file("a.txt").decode("utf-8") == "x = 1\nx = 1\n"


def test_edit_missing_file_not_found(make_vfs):
    vfs = make_vfs()
    with pytest.raises(AppError) as exc_info:
        vfs.edit_file("missing.py", "a", "b")
    assert exc_info.value.code is ErrorCode.file_not_found


# ------------------------------------------------------------- 2. delete + tombstone


def test_delete_flow_tombstone(make_vfs, tmp_path):
    vfs = make_vfs()
    sha = vfs.write_file("a.txt", "nội dung sẽ xóa")["sha256"]

    result = vfs.delete_file("a.txt")
    assert result == {"path": "a.txt", "rev": 2, "sha256": sha, "origin": "vfs"}
    assert vfs.revision == 2
    assert vfs.list_files() == []

    conn = open_db(tmp_path)
    try:
        row = conn.execute("SELECT * FROM tombstones WHERE path = 'a.txt'").fetchone()
        assert row is not None
        assert row["rev"] == 2
        assert row["sha256"] == sha
        assert row["origin"] == "vfs"
        assert row["blob_ref"] is None
    finally:
        conn.close()

    with pytest.raises(AppError) as exc_info:
        vfs.read_file("a.txt")
    assert exc_info.value.code is ErrorCode.file_not_found

    # Xóa lần 2 → file không còn → lỗi.
    with pytest.raises(AppError) as exc_info:
        vfs.delete_file("a.txt")
    assert exc_info.value.code is ErrorCode.file_not_found


def test_delete_origin_validation(make_vfs):
    vfs = make_vfs()
    vfs.write_file("sbx.txt", "v")
    assert vfs.delete_file("sbx.txt", origin="sandbox")["origin"] == "sandbox"

    with pytest.raises(AppError) as exc_info:
        vfs.delete_file("sbx.txt", origin="mcp")
    assert exc_info.value.code is ErrorCode.invalid_request


# ------------------------------------------------------------ 3. lịch sử revision (C5)


def test_revision_cap_20(make_vfs, tmp_path):
    vfs = make_vfs()
    shas = [vfs.write_file("hist.txt", f"noi dung {i}")["sha256"] for i in range(1, 26)]

    history = vfs.get_revisions("hist.txt", limit=100)
    assert len(history) == 20  # trần 20 bản mới nhất

    # Mới nhất trước: bản 25 (before = 24).
    assert history[0]["after_sha"] == shas[24]
    assert history[0]["before_sha"] == shas[23]
    # Cũ nhất còn lại: bản 6 (before = 5) — 4 bản cũ nhất (2..5) đã bị xóa.
    assert history[-1]["before_sha"] == shas[4]
    assert history[-1]["after_sha"] == shas[5]

    conn = open_db(tmp_path)
    try:
        count = conn.execute(
            "SELECT COUNT(*) FROM file_revisions WHERE path = 'hist.txt'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert count == 20
    assert vfs.revision == 25


def test_large_patch_placeholder(make_vfs):
    vfs = make_vfs()
    big_text = "BẮT ĐẦU\n" + "x" * 1_500_000 + "\nKẾT THÚC\n"
    vfs.write_file("big.txt", big_text)

    vfs.edit_file("big.txt", "BẮT ĐẦU", "BEGIN")
    history = vfs.get_revisions("big.txt")
    assert len(history) == 1
    patch = history[0]["patch"]
    assert patch.startswith("[full-content-skipped:")
    assert patch.endswith(" bytes]")
    assert len(patch) < 60  # KHÔNG chứa toàn bộ nội dung 1.5MB


# ------------------------------------------------------- 4. blob sidecar + import (C1)


def test_blob_sidecar_roundtrip(make_vfs, tmp_path):
    vfs = make_vfs()
    data = os.urandom(33 * 1024 * 1024)  # 33MB ≥ ngưỡng 32MB
    sha = hashlib.sha256(data).hexdigest()

    result = vfs.write_file("big.bin", data)
    assert result["storage_class"] == "blob"
    assert result["sha256"] == sha

    info = vfs.get_file_info("big.bin")
    assert info["blob_ref"] == sha
    assert info["is_binary"] == 1

    conn = open_db(tmp_path)
    try:
        row = conn.execute("SELECT content FROM files WHERE path = 'big.bin'").fetchone()
        assert row[0] is None  # content NULL trong DB
    finally:
        conn.close()

    blob_path = tmp_path / "ws" / "blobs" / sha
    assert blob_path.is_file()
    assert hashlib.sha256(blob_path.read_bytes()).hexdigest() == sha

    read_back = vfs.read_file("big.bin")
    assert hashlib.sha256(read_back).hexdigest() == sha  # roundtrip đúng bytes

    # Không để sót file temp trong workspace_dir lẫn blobs/.
    leftovers = [p.name for p in (tmp_path / "ws").iterdir() if p.name.startswith(".vfs-")]
    assert leftovers == []
    assert [p.name for p in (tmp_path / "ws" / "blobs").iterdir()] == [sha]


def test_import_blob_roundtrip_and_missing_sidecar(make_vfs, tmp_path):
    vfs = make_vfs()
    data = b"A" * (200 * 1024)
    sha = hashlib.sha256(data).hexdigest()

    # Sidecar được ghi TRƯỚC bằng BlobStore riêng trỏ đúng thư mục blobs/ của VFS
    # (đúng trách nhiệm caller — W1.4 chunked upload complete).
    sidecar = BlobStore(tmp_path / "ws" / "blobs")
    written = sidecar.write_stream(sha, iter([data[:1000], data[1000:]]))
    assert written == len(data)

    result = vfs.import_blob("uploads/big.bin", sha, len(data))
    assert result["storage_class"] == "blob"
    assert result["rev"] == 1
    assert vfs.read_file("uploads/big.bin") == data
    assert vfs.get_file_info("uploads/big.bin")["blob_ref"] == sha

    # write_stream verify sha: sai → invalid_request, không để sót temp.
    with pytest.raises(AppError) as exc_info:
        sidecar.write_stream("f" * 64, iter([b"noi dung khac"]))
    assert exc_info.value.code is ErrorCode.invalid_request
    assert all(not name.endswith(".tmp") for name in os.listdir(sidecar.root))

    # import_blob KHÔNG kiểm tra sidecar tồn tại (trách nhiệm caller — docstring):
    # row vẫn được ghi, chỉ khi read mới lỗi file_not_found.
    missing_sha = hashlib.sha256(b"ghost").hexdigest()
    ghost = vfs.import_blob("ghost.bin", missing_sha, 123)
    assert ghost["sha256"] == missing_sha
    with pytest.raises(AppError) as exc_info:
        vfs.read_file("ghost.bin")
    assert exc_info.value.code is ErrorCode.file_not_found


# ------------------------------------------------------------------- 5. hạn mức (C1)


def test_quota_exceeded(tmp_path):
    vfs = VFS(tmp_path / "ws.sqlite", Settings(workspace_quota_bytes=1000))
    try:
        with pytest.raises(AppError) as exc_info:
            vfs.write_file("a.bin", b"x" * 2048)
        assert exc_info.value.code is ErrorCode.quota_exceeded
        assert exc_info.value.details == {"used": 0, "incoming": 2048, "quota": 1000}
        assert vfs.list_files() == []  # file không được ghi

        vfs.write_file("small.txt", "y" * 400)
        with pytest.raises(AppError) as exc_info:
            vfs.write_file("b.txt", "z" * 700)
        assert exc_info.value.details == {"used": 400, "incoming": 700, "quota": 1000}
    finally:
        vfs.close()


# ------------------------------------------------------- 6. ignore 3 tầng (C2, nguyên tắc 4)


def test_ignore_tier1_block_and_force_freeze_warning(make_vfs):
    vfs = make_vfs()
    for path in ("node_modules/pkg/index.js", ".git/config"):
        with pytest.raises(AppError) as exc_info:
            vfs.write_file(path, "noi dung")
        assert exc_info.value.code is ErrorCode.ignored_path
        assert path in exc_info.value.message
        assert "force" in exc_info.value.message  # gợi ý force=true

        result = vfs.write_file(path, "noi dung", force=True)
        assert result["warnings"]
        assert any("đóng băng" in warning for warning in result["warnings"])

    # Path thường → không warning.
    assert vfs.write_file("src/app.py", "print()")["warnings"] == []


def test_tier3_tmp_scratch_forbidden(make_vfs):
    vfs = make_vfs()
    for path in ("tmp/thing.txt", "scratch/x"):
        with pytest.raises(AppError) as exc_info:
            vfs.write_file(path, "data", force=True)  # kể cả force=True
        assert exc_info.value.code is ErrorCode.forbidden_path
    assert vfs.list_files() == []


# ------------------------------------------------------------- 7. chuẩn hóa đường dẫn


def test_path_canonicalization_cases():
    # Reject.
    for bad in ("", "   ", "a\x00b", "x" * 4097, "../etc/passwd", "a/../../b", ".", ".."):
        with pytest.raises(AppError) as exc_info:
            canonicalize_path(bad)
        assert exc_info.value.code is ErrorCode.invalid_path, bad

    # Chuẩn hóa.
    assert canonicalize_path("/src/app.py") == "src/app.py"
    assert canonicalize_path("\\src\\app.py") == "src/app.py"
    assert canonicalize_path("C:\\work\\src\\app.py") == "work/src/app.py"
    assert canonicalize_path("src/./app.py") == "src/app.py"
    assert canonicalize_path("a//b///c") == "a/b/c"
    assert canonicalize_path("a/..b/c") == "a/..b/c"  # segment '..b' hợp lệ

    # NFC hóa tên file tiếng Việt có dấu tổ hợp (NFD).
    nfd = "cafe\u0301.py"
    nfc = unicodedata.normalize("NFC", nfd)
    assert nfd != nfc
    assert canonicalize_path(nfd) == nfc


def test_path_nfc_normalized_in_db(make_vfs):
    vfs = make_vfs()
    nfd = "thu-muc/caf\u0065\u0301.py"
    nfc = unicodedata.normalize("NFC", nfd)
    assert nfd != nfc

    vfs.write_file(nfd, "hi")
    info = vfs.get_file_info(nfc)
    assert info is not None
    assert info["path"] == nfc  # row trong DB là NFC
    assert vfs.read_file(nfc) == b"hi"


# ------------------------------------------------------- 8. hook sync (W3 — chỉ cột)


def test_set_synced_sha_preserved_on_update(make_vfs):
    vfs = make_vfs()
    vfs.write_file("f.txt", "v1")
    vfs.set_synced_sha("f.txt", "sha-sync-1")
    assert vfs.get_file_info("f.txt")["synced_sha256"] == "sha-sync-1"

    # Ghi nội dung mới: revision bump nhưng synced_sha256 GIỮ NGUYÊN (chưa push lại).
    vfs.write_file("f.txt", "v2")
    info = vfs.get_file_info("f.txt")
    assert info["synced_sha256"] == "sha-sync-1"
    assert info["rev"] == 2
    assert vfs.revision == 2

    # File mới → synced_sha256 NULL.
    vfs.write_file("g.txt", "v1")
    assert vfs.get_file_info("g.txt")["synced_sha256"] is None
