"""Khởi tạo database + (tùy chọn) nạp dữ liệu mẫu để test các thuật toán của VFS.

Cách dùng (chạy từ gốc repo):
    python3 scripts/init_db.py                 # chỉ tạo system.sqlite (idempotent)
    python3 scripts/init_db.py --seed          # + workspace mẫu cho từng thuật toán
    python3 scripts/init_db.py --seed --big    # + file 33MB đi đường file rời (blob)
    python3 scripts/init_db.py --reset --seed  # xóa sạch data_dir rồi nạp lại
    python3 scripts/init_db.py --data-dir /tmp/x --seed

Mỗi workspace mẫu minh họa một thuật toán; script TỰ KIỂM kết quả mong đợi và in ✓/✗
(thoát mã 1 nếu có ✗). Nhãn workspace ghi vào ``{data_dir}/seed-manifest.json`` để trang
``/admin/vfs`` hiển thị tên + thuật toán. Nên dừng server trước khi ``--reset``.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import unicodedata
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sandbox_kit_clone.config import get_settings
from sandbox_kit_clone.errors import AppError, ErrorCode
from sandbox_kit_clone.manager.manager import Manager
from sandbox_kit_clone.providers.fake import FakeProvider
from sandbox_kit_clone.system.schema import init_system_db
from sandbox_kit_clone.vfs.core import MAX_REVISIONS_PER_FILE

MANIFEST_NAME = "seed-manifest.json"

# PNG 1x1 hợp lệ — có byte NULL → is_binary=1.
_PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


class Checker:
    """Gom kết quả tự kiểm: in ✓/✗ theo từng kỳ vọng."""

    def __init__(self) -> None:
        self.failed = 0

    def check(self, ok: bool, label: str) -> None:
        print(f"    {'✓' if ok else '✗'} {label}")
        if not ok:
            self.failed += 1

    def expect_error(self, fn, code: ErrorCode, label: str) -> None:
        try:
            fn()
        except AppError as exc:
            self.check(exc.code is code, f"{label} → {exc.code.value}")
            return
        self.check(False, f"{label} → KHÔNG bị chặn")


def _ws(manager: Manager, name: str, policy: str = "sandbox_wins"):
    created = manager.create_workspace(name, policy)
    _, vfs = manager.resolve_session(created["session_id"])
    return created, vfs


def seed_basic(manager: Manager, c: Checker) -> tuple[dict, str]:
    created, vfs = _ws(manager, "demo-basic")
    try:
        vfs.write_file("README.md", "# Demo dự án\n\nDự án mẫu cho bảng quản lý VFS.\n")
        vfs.write_file(
            "src/app.py",
            'def greet(name: str) -> str:\n    return f"Xin chào, {name}!"\n\n\n'
            'if __name__ == "__main__":\n    print(greet("VFS"))\n',
        )
        vfs.write_file(
            "tests/test_app.py",
            "from src.app import greet\n\n\ndef test_greet():\n"
            '    assert greet("A") == "Xin chào, A!"\n',
        )
        vfs.write_file("config/settings.json", json.dumps({"debug": True, "port": 8080}, indent=2))
        info = vfs.write_file("assets/logo.png", _PNG_1X1)
        c.check(vfs.get_file_info("assets/logo.png")["is_binary"] == 1, "PNG nhận diện là nhị phân")
        # Đường dẫn bẩn → chuẩn hóa về một dạng duy nhất.
        nfd = unicodedata.normalize("NFD", "docs/tài-liệu.md")
        res = vfs.write_file("/docs/./" + nfd.split("/", 1)[1], "# Tài liệu\n")
        c.check(res["path"] == unicodedata.normalize("NFC", "docs/tài-liệu.md"),
                f"NFD + '/./' + '/' đầu → '{res['path']}' (NFC)")
        res = vfs.write_file("src\\utils\\helpers.py", "def add(a, b):\n    return a + b\n")
        c.check(res["path"] == "src/utils/helpers.py", "dấu '\\' → '/'")
        c.expect_error(lambda: vfs.write_file("../etc/passwd", "x"), ErrorCode.invalid_path,
                       "escape gốc '../etc/passwd'")
        c.check(info["storage_class"] == "vfs", "file nhỏ lưu trong DB (storage=vfs)")
    finally:
        vfs.close()
    return created, "Chuẩn hóa đường dẫn (NFC, '\\', '/./', escape) + nhận diện nhị phân"


def seed_history(manager: Manager, c: Checker) -> tuple[dict, str]:
    created, vfs = _ws(manager, "demo-history")
    try:
        path = "src/counter.py"
        vfs.write_file(path, "COUNT = 0\n")
        for i in range(1, MAX_REVISIONS_PER_FILE + 6):  # 25 lần sửa > trần 20
            vfs.write_file(path, f"COUNT = {i}\n")
        n = len(vfs.get_revisions(path, limit=100))
        c.check(n == MAX_REVISIONS_PER_FILE, f"25 lần sửa → giữ {n}/{MAX_REVISIONS_PER_FILE} bản lịch sử")
        rev_before = vfs.revision
        noop = vfs.write_file(path, f"COUNT = {MAX_REVISIONS_PER_FILE + 5}\n")
        c.check(noop.get("noop") is True and vfs.revision == rev_before, "ghi trùng sha → no-op, revision giữ nguyên")

        src = "def total(items):\n    result = 0\n    for x in items:\n        result += x\n    return result\n"
        vfs.write_file("src/calc.py", src)
        exact = vfs.edit_file("src/calc.py", "result = 0", "result = 0  # khởi tạo")
        c.check(exact["used_fuzzy"] is False, "edit mức 1: khớp chính xác")
        fuzzy = vfs.edit_file("src/calc.py", "for   x  in items:\n  result   += x", "for x in items:\nresult += x * 2")
        c.check(fuzzy["used_fuzzy"] is True, "edit mức 2: lệch khoảng trắng → khớp mờ, giữ indent")
        text = vfs.read_file("src/calc.py").decode()
        c.check("    for x in items:\n    result += x * 2" in text, "indent gốc được áp cho đoạn thay")
        vfs.write_file("src/dup.py", "x = 1\nx = 1\n")
        c.expect_error(lambda: vfs.edit_file("src/dup.py", "x = 1", "x = 2"),
                       ErrorCode.invalid_request, "edit mức 3: khớp nhiều vị trí")
        c.expect_error(lambda: vfs.edit_file("src/calc.py", "khong_ton_tai", "y"),
                       ErrorCode.invalid_request, "edit mức 3: không tìm thấy")
    finally:
        vfs.close()
    return created, "Lịch sử tối đa 20 bản + no-op cùng sha + sửa khớp mờ 3 mức"


def seed_tombstone(manager: Manager, c: Checker) -> tuple[dict, str]:
    created, vfs = _ws(manager, "demo-tombstone")
    try:
        for name in ("old_a.txt", "old_b.txt", "keep.txt", "reborn.txt"):
            vfs.write_file(f"legacy/{name}", f"nội dung {name}\n")
        rev = vfs.revision
        vfs.delete_file("legacy/old_a.txt")
        vfs.delete_file("legacy/old_b.txt", origin="sandbox")
        c.check(vfs.revision == rev + 2, "mỗi lần xóa tăng revision")
        c.check(vfs.get_file_info("legacy/old_a.txt") is None, "file đã xóa không còn trong files")
        vfs.delete_file("legacy/reborn.txt")
        vfs.write_file("legacy/reborn.txt", "tạo lại sau khi xóa\n")
        tombs = {r["path"]: r for r in vfs._conn.execute("SELECT * FROM tombstones").fetchall()}
        c.check({"legacy/old_a.txt", "legacy/old_b.txt"} <= tombs.keys(), "để lại dấu xóa (tombstone)")
        c.check(tombs["legacy/old_b.txt"]["origin"] == "sandbox", "ghi nhận origin='sandbox'")
        c.expect_error(lambda: vfs.delete_file("legacy/old_a.txt"), ErrorCode.file_not_found,
                       "xóa lại file đã xóa")
    finally:
        vfs.close()
    return created, "Xóa để lại dấu (tombstone), origin vfs/sandbox, tạo lại sau xóa"


def seed_ignore(manager: Manager, c: Checker) -> tuple[dict, str]:
    """Kho chỉ giữ mã nguồn đẩy lên GitHub — thư viện / môi trường / cache / build bị từ chối."""
    created, vfs = _ws(manager, "demo-ignore")
    try:
        for path, content in (
            ("package.json", '{"name": "demo", "version": "1.0.0"}\n'),
            ("requirements.txt", "fastapi\n"),
            (".gitignore", "node_modules/\n.venv/\n"),
            ("src/index.js", "console.log('hi');\n"),
            ("tmp/notes.md", "thư mục tmp/ giờ là mã nguồn bình thường\n"),
        ):
            vfs.write_file(path, content)
        c.check(len(vfs.list_files()) == 5, "mã nguồn (kể cả tmp/, .gitignore) được lưu")
        for path in ("node_modules/lodash/index.js", ".venv/lib/site.py", "src/__pycache__/a.pyc",
                     "dist/bundle.js", "mypkg.egg-info/PKG-INFO", "src/.DS_Store"):
            c.expect_error(lambda p=path: vfs.write_file(p, "x"), ErrorCode.ignored_path, f"không lưu '{path}'")
        c.check(len(vfs.list_files()) == 5, "không file thư viện / build nào lọt vào kho")
    finally:
        vfs.close()
    return created, "Chỉ lưu mã nguồn dự án — không lưu thư viện, .venv, node_modules, cache, build"


def seed_policy(manager: Manager, c: Checker) -> tuple[dict, str]:
    created, vfs = _ws(manager, "demo-policy-error", policy="error")
    try:
        vfs.write_file("main.go", 'package main\n\nfunc main() {}\n')
        row = vfs._conn.execute("SELECT conflict_policy FROM workspace_meta").fetchone()
        c.check(row[0] == "error", "conflict_policy='error' ghi vào workspace_meta")
    finally:
        vfs.close()
    c.expect_error(lambda: manager.create_workspace("x", "hero_wins"), ErrorCode.invalid_request,
                   "conflict_policy sai giá trị")
    return created, "Chính sách xung đột 'error' (W3 dùng khi nhận về)"


def seed_blob(manager: Manager, c: Checker) -> tuple[dict, str]:
    created, vfs = _ws(manager, "demo-blob")
    try:
        size = manager.settings.blob_sidecar_min_bytes + 1024 * 1024
        data = os.urandom(size)
        res = vfs.write_file("assets/dataset.bin", data)
        c.check(res["storage_class"] == "blob", f"{size // (1024 * 1024)}MB ≥ ngưỡng → lưu file rời (blob)")
        c.check(vfs.blobs.has(res["sha256"]), "file rời nằm ở workspaces/{id}/blobs/{sha256}")
        c.check(vfs.read_file("assets/dataset.bin") == data, "đọc lại đúng từng byte")
    finally:
        vfs.close()
    return created, "File lớn ≥32MB lưu thành file rời (blob sidecar)"


def seed_quota(manager: Manager, c: Checker) -> tuple[dict, str]:
    """Hạn mức: dùng Manager riêng với quota nhỏ (64KB) cho cùng data_dir."""
    small = Manager(replace(manager.settings, workspace_quota_bytes=64 * 1024), manager.provider)
    created, vfs = _ws(small, "demo-quota")
    try:
        vfs.write_file("data/part1.txt", "a" * 40 * 1024)
        c.expect_error(lambda: vfs.write_file("data/part2.txt", "b" * 30 * 1024),
                       ErrorCode.quota_exceeded, "40KB + 30KB > hạn mức thử 64KB")
    finally:
        vfs.close()
        small.store.close()
    return created, "Hạn mức dung lượng (seed với quota 64KB; server dùng quota cấu hình)"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", help="ghi đè SANDBOX_KIT_DATA_DIR")
    parser.add_argument("--seed", action="store_true", help="nạp workspace mẫu cho từng thuật toán")
    parser.add_argument("--big", action="store_true", help="kèm file ≥32MB (đường file rời)")
    parser.add_argument("--reset", action="store_true", help="XÓA data_dir trước khi khởi tạo")
    args = parser.parse_args()

    settings = get_settings()
    if args.data_dir:
        settings = replace(settings, data_dir=args.data_dir)
    data_dir = Path(settings.data_dir)

    if args.reset and data_dir.exists():
        print(f"Xóa {data_dir.resolve()} …")
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    system_db = data_dir / "system.sqlite"
    init_system_db(system_db).close()
    print(f"✓ system DB: {system_db.resolve()}")
    if not args.seed:
        return 0

    manager = Manager(settings, FakeProvider(base_dir=data_dir / "fake-sandboxes"))
    c = Checker()
    steps = [seed_basic, seed_history, seed_tombstone, seed_ignore, seed_policy, seed_quota]
    if args.big:
        steps.append(seed_blob)
    manifest = []
    for step in steps:
        print(f"\n▸ {step.__name__.removeprefix('seed_')}")
        created, demonstrates = step(manager, c)
        print(f"    workspace={created['workspace_id']} session={created['session_id']}")
        manifest.append({**created, "demonstrates": demonstrates})
    manager.store.close()

    manifest_path = data_dir / MANIFEST_NAME
    old = []
    if manifest_path.is_file():
        try:
            old = json.loads(manifest_path.read_text(encoding="utf-8")).get("workspaces", [])
        except ValueError:
            old = []
    manifest_path.write_text(
        json.dumps({"workspaces": old + manifest}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n✓ manifest: {manifest_path.resolve()}")
    print(f"{'✗ ' + str(c.failed) + ' kỳ vọng sai' if c.failed else '✓ mọi kỳ vọng đều đúng'}"
          " — mở http://127.0.0.1:8000/admin/vfs để xem")
    return 1 if c.failed else 0


if __name__ == "__main__":
    sys.exit(main())
