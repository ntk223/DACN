# W1 — Báo cáo triển khai (as-built)

> **Trạng thái:** AS-BUILT — mô tả code thật của Tuần 1, đối chiếu với thiết kế `system-design.md`.
> **Phạm vi:** nền VFS + MCP gateway + fake provider (chưa có Docker thật, chưa có đồng bộ).
> **Commit:** `00bfe6b` (2026-11-12) · **Quy mô:** 33 file Python, ~4.280 dòng · **Test:** 56 passed, coverage 91%.
> **Đối tượng đọc:** kỹ sư review, người tham gia Tuần 2+.

---

## 1. Kiến trúc triển khai W1

**Topology: 1 tiến trình Python** chứa toàn bộ các thành phần trong hệ — quy tắc
"mỗi file SQLite chỉ một writer" thỏa tự nhiên (nguyên tắc §2.3 của system-design).

```text
MCP CLIENT (Claude / Cursor / Inspector / script SDK)
   │  streamable HTTP stateless (JSON-RPC)
   ▼
┌───────────────────────────────────────────────────────────────┐
│ FastAPI app (uvicorn)                                         │
│  ├── FastMCP mount tại /mcp      ← 13 tools (gateway/mcp_server)
│  ├── upload_router /download_router  ← file lớn (gateway/upload)
│  ├── /health                                                  │
│  └── install_error_handlers  ← AppError → JSON chuẩn          │
│                                                               │
│  Manager (manager/manager.py)                                 │
│   ├── SystemStore  → data/system.sqlite        (4 bảng)       │
│   ├── resolve_session → VFS (mở mới mỗi call)                 │
│   └── SandboxProvider (ABC) → FakeProvider (W1)               │
│                                                               │
│  VFS (vfs/core.py)                                            │
│   ├── SQLite WAL  → data/workspaces/{id}.sqlite (5 bảng)      │
│   ├── BlobStore   → data/workspaces/{id}/blobs/{sha256}       │
│   └── staging     → data/staging/upload/{token}/chunk_NNN     │
└───────────────────────────────────────────────────────────────┘
```

**Tách giao thức theo kích thước file** (§4 system-design):
- ≤ ~3 MB (`inline_max_bytes`): đi qua MCP tool `file_write`/`file_read`.
- > ~3 MB: đi REST riêng `POST /upload → PUT /upload/{token}?chunk=N → complete`.
- ≥ 32 MB (`blob_sidecar_min_bytes`): lưu thành file rời `blobs/{sha256}`, DB chỉ giữ con trỏ.

---

## 2. Module map

| Module | Dòng | Trách nhiệm | Coverage |
|---|---:|---|---:|
| `vfs/core.py` | 194 | **VFS lõi**: write/read/edit/delete→tombstone/import_blob, revision, history C5, transaction `BEGIN IMMEDIATE` + `Lock` | 90% |
| `vfs/paths.py` | 28 | Canonicalization duy nhất: NFC, chặn `..`/escape | 100% |
| `vfs/ignore.py` | 16 | Quy tắc **không lưu** duy nhất (thay C2 3 tầng — xem A12): thư viện / môi trường / cache / build → `ignored_path` | 100% |
| `vfs/fuzzy.py` | 40 | Sửa khớp 3 mức: exact ×1 → dòng chuẩn hóa whitespace (giữ indent) → lỗi | 100% |
| `vfs/blob.py` | 76 | `BlobStore` content-addressed: ghi `.{sha}.tmp` → fsync → rename; verify sha | 93% |
| `vfs/quota.py` | 9 | `used_bytes` (SUM files.size) + `check_quota` → `quota_exceeded` | 100% |
| `vfs/schema.py` | 20 | 5 bảng workspace DB + PRAGMA WAL/NORMAL/foreign_keys + seed | 100% |
| `system/store.py` | 96 | `SystemStore`: CRUD workspace/session, sync_state, **operations idempotent theo `request_id` UNIQUE** | 96% |
| `system/schema.py` | 18 | 4 bảng system DB | 100% |
| `manager/manager.py` | 166 | Điều phối: create_workspace (retry id trùng ×3), resolve_session, vòng đời sandbox + ghi sổ `_op()` | 84% |
| `providers/base.py` | 27 | ABC `SandboxProvider` — 9 method abstract + 3 optional default raise | 100% |
| `providers/fake.py` | 81 | Fake in-memory: state machine created/running/paused/stopped, `dial_port` tăng từ 50000, terminate idempotent, ttl≤0 = không hết hạn | 99% |
| `gateway/app.py` | 36 | Lắp ráp: create_app = REST + FastMCP mount `/mcp` + lifespan `session_manager.run()` | 100% |
| `gateway/mcp_server.py` | 101 | 13 tools; ranh giới lỗi `_safe()`: `AppError` → payload, không raise qua kênh MCP | 93% |
| `gateway/upload.py` | 185 | Chunked upload (init/put/status/delete/complete) + download stream 1MB/lượt | 96% |
| `gateway/http_error.py` | 23 | `AppError` → HTTP: 404 (not_found), 409 (conflict), 413 (quota), mặc định 400; override qua `details={"http_status": N}` | 100% |
| `gateway/deps.py` | 41 | Đường dẫn data + `get_vfs` (per-call) + registry staging in-memory | 95% |
| `gateway/gc.py` | 25 | `gc_staging`: xóa token quá `staging_max_age_hours` (hàm thuần, chưa có scheduler) | 92% |
| `config.py` | 36 | `Settings` frozen + `get_settings()` cached — env prefix `SANDBOX_KIT_*` | 64% |
| `errors.py` | 26 | `ErrorCode` (10 mã) + `AppError.to_payload()` | 92% |
| `main.py` | 18 | Entry `uvicorn.run` | 0% (script) |

---

## 3. Tool catalog MCP (13 tools)

Mọi tool trả `dict`; lỗi trả `{"error": {"code", "message", "details"?}}` — **không bao giờ
raise qua kênh MCP** (agent AI đọc được lỗi có cấu trúc, không bị tool-call gãy).

| Nhóm | Tool | Chữ ký chính | Ghi chú |
|---|---|---|---|
| workspace | `workspace_create` | `(name="") → {workspace_id, session_id}` | id 12 hex, session STANDBY |
| sandbox | `sandbox_start` | `(session_id, ttl_seconds=3600, cpu?, memory?)` | chỉ khi STANDBY; ttl≤0 = không hết hạn |
| | `sandbox_stop` / `pause` / `resume` / `renew` | `(session_id, ...)` | kiểm state chuyển hợp lệ, sai → `invalid_request` |
| | `sandbox_status` | `(session_id)` | có `provider_state` từ provider |
| files | `file_write` | `(session_id, path, content)` | >3MB → `file_too_large` + `upload_hint`; đường dẫn thư viện / build → `ignored_path` |
| | `file_read` | `(session_id, path)` | binary → base64 + `encoding`; ≥3MB → `download_url` |
| | `file_edit` | `(session_id, path, old_text, new_text)` | trả `used_fuzzy` |
| | `file_delete` | `(session_id, path)` | tombstone, `origin="vfs"` |
| | `file_list` | `(session_id)` | không trả content |
| sync | `sync_status` | `(session_id)` | W1 stub: `{workspace_revision, status, pending_push: 0}` |

## 4. REST endpoints (file lớn + sức khỏe)

| Method + Path | Chức năng | Lỗi |
|---|---|---|
| `GET /health` | sống + version | — |
| `POST /upload` | khai báo `{workspace_id, path, size, sha256?}` → `{token, upload_url, chunk_size=4MB}` | 404 workspace_not_found, 413 quota |
| `PUT /upload/{token}?chunk=N` | gửi phần raw bytes; header `X-Chunk-Sha256` tùy chọn (verify) | 404 token lạ/đã complete |
| `POST /upload/{token}/complete` | ghép đủ chunk 0..N-1 → verify sha tổng → ≥32MB: BlobStore + `import_blob`; <32MB: `write_file` → xóa staging | 400 thiếu chunk, 409 sha lệch (giữ staging) |
| `GET /upload/{token}/status` | số chunk nhận được | 404 |
| `DELETE /upload/{token}` | hủy + dọn staging | 404 |
| `GET /download/{workspace_id}?path=…` | stream (1MB/lượt) + header `X-File-Sha256` | 404 file/workspace |

## 5. Quyết định triển khai as-built

| # | Quyết định | Lý do / khác biệt so với thiết kế |
|---|---|---|
| A1 | **SQLite đồng bộ** (không aiosqlite); FastAPI endpoint sync qua threadpool | 1 process 1 writer; giảm biến thể PoC; `aiosqlite` chỉ cần khi tách process |
| A2 | **VFS mở connection mới mỗi call, không cache** | tránh stale connection; chi phí thấp ở W1; xem lại khi đo hiệu năng (W4) |
| A3 | **Blob sidecar = `workspaces/{id}/blobs/{sha256}`** | fix giữa chừng: bản đầu `db.parent/blobs` dùng chung mọi dự án → xóa dự án sót rác; hiện đúng §6.1 |
| A4 | **MCP mount: `streamable_http_path="/"`** | FastMCP v1 mặc định sinh `/mcp/mcp` khi mount tại `/mcp`; thiết này để URL đúng `/mcp` |
| A5 | **Lỗi tool = payload `{"error": …}`, không raise** | agent AI đọc lỗi có cấu trúc; tool-call không gãy giữa chừng |
| A6 | `file_write` với file >3MB → mã `file_too_large` + `upload_hint` (chưa trả `upload_url` như §4) | PoC W1: client dùng REST trực tiếp; flow metadata→upload_url hoàn thiện W5 |
| A7 | **History C5 trong core VFS**: same-sha no-op; patch full-content chỉ cho text ≤1MB; trần 20 patch/path (DELETE sau INSERT) | đúng §10-C5; placeholder `"[full-content-skipped: N bytes]"` |
| A8 | ~~Seed volume W1 = copy nguyên thư mục workspace~~ | **Lỗi, đã sửa ở W2:** thư mục đó chỉ chứa blob, file nguồn nằm trong SQLite → sandbox nhận 0 file. W2 xuất file từ VFS ra volume (xem `w2-implementation.md`) |
| A9 | **`request_id` do server sinh (uuid)** — chưa client-driven | idempotency thật (client gửi lại mã cũ) là hardening W4 |
| A10 | Binary đọc: `\0` trong 8000 byte đầu → `is_binary`; decode UTF-8 fail vẫn base64 | an toàn hai lớp |
| A11 | `gc_staging` là hàm thuần, chưa scheduler | gọi trong test/gate; scheduler asyncio đặt W4 cùng reaper |
| A12 | **Bỏ mô hình ignore 3 tầng (C2, §7.8)** → một quy tắc "không lưu": kho chỉ giữ mã nguồn dự án đẩy lên GitHub. Bỏ `force`, cảnh báo "đóng băng", `warnings` trong kết quả ghi, mã lỗi `forbidden_path`; `tmp/`/`scratch/` thành thư mục thường. Upload chặn ngay ở `POST /upload` | quyết định 2026-11-19: đơn giản hóa — không có file thư viện "đóng băng" trong kho; W3 pull-back bỏ qua cùng danh sách `vfs/ignore.py` |

## 6. Kết quả kiểm chứng (gate W1)

- `pytest`: **56 passed** (20 VFS conformance · 13 upload · 11 provider · 6 schemas · 6 gateway E2E).
- **Coverage 91%** tổng; chi tiết theo bảng §2. Lỗ chính: `main.py` 0% (entry script), `config.py` 64% (nhánh env mặc định), `manager.py` 84% (nhánh lỗi renew/pause ít được phủ).
- Smoke **client MCP SDK thật** (streamablehttp_client): 12/12 bước — list 13 tools, create → write → read → edit → guard ignore → sandbox lifecycle → delete/list.
- Demo tiêu chí **A5**: 50MB = 13 chunk (12×4MB + 2MB) → sidecar `workspaces/{id}/blobs/{sha}` đúng §6.1 → download stream byte-đúng (sha khớp).
- Transport JSON-RPC thủ công cũng chạy được (redirect 307 `/mcp` → `/mcp/` — SDK tự follow).

## 7. Giới hạn đã biết (khoảng trống có chủ đích)

| Khoảng trống | Đổ vào tuần |
|---|---|
| Chưa chạy lệnh trong sandbox (không có exec agent gRPC, không có image) | **W2** |
| Chưa có command policy gate 2 lớp | **W2** |
| Chưa pull-back / conflict / tombstone-GC / watermark (`synced_sha256` đã có cột, chưa dùng) | **W3** |
| Chưa reaper/sweeper/recovery/scheduler GC | **W4** |
| Chưa có `git_*` tools, chưa hoàn thiện flow `upload_url` trong tool | **W5** (stretch git) |
| Provider Docker chưa có — chỉ FakeProvider | **W2.1** |

## 8. Cách chạy

```bash
make run          # server tại http://127.0.0.1:8000 (MCP: /mcp)
make test         # lint + pytest
python3 scripts/smoke_mcp_client.py http://127.0.0.1:8000/mcp   # smoke 12 bước
PYTHONPATH=src pytest tests/ -q --cov=sandbox_kit_clone         # coverage
```

Cấu hình qua env (`SANDBOX_KIT_*`) — xem `.env.example`: ngưỡng inline 3MB, sidecar 32MB,
quota 2GB, staging 24h, policy mode `audit` (chưa dùng đến W1).
