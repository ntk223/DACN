# Sandbox Kit Clone (W1 PoC)

Nền tảng cho AI agent lập trình làm việc trên code qua MCP — VFS (SQLite) là kho lưu trữ
trung tâm, sandbox chạy qua provider (PoC dùng bộ giả lập).

## Cấu trúc

```
src/sandbox_kit_clone/
├── config.py, errors.py, main.py    # cấu hình, bộ lỗi chuẩn, điểm vào server
├── vfs/        # kho file: core (VFS), schema, blob, fuzzy, ignore, quota, paths
├── system/     # DB hệ thống: schema + SystemStore (workspaces/sessions/ops)
├── providers/  # ABC SandboxProvider + FakeProvider (in-memory) + DockerProvider + factory
├── manager/    # Manager: điều phối workspace/session/sandbox
└── gateway/    # FastAPI app: MCP mount /mcp, upload/download, health, serve /admin
web/               # giao diện quản trị React (Vite + TS) — build ra web/dist (make web)
sandbox-image/Dockerfile           # image sandbox (make image)
scripts/smoke_mcp_client.py        # smoke test bằng MCP client SDK thật
```

## Chạy nhanh

```bash
make test; make lint   # pytest + ruff check src tests
make web      # build giao diện quản trị React (web/dist) — cần Node.js
make seed     # tạo DB + workspace mẫu cho từng thuật toán VFS (tự kiểm ✓/✗)
make run      # server tại http://127.0.0.1:8000
python3 scripts/smoke_mcp_client.py    # smoke qua MCP thật (server phải đang chạy)
```

MCP endpoint: `http://127.0.0.1:8000/mcp` (transport streamable-http, stateless).

## Khởi tạo DB & dữ liệu mẫu

| Lệnh | Tác dụng |
| :--- | :--- |
| `make init-db` | Tạo `data/system.sqlite` (idempotent) |
| `make seed` | + 6 workspace mẫu: chuẩn hóa đường dẫn, lịch sử 20 bản + khớp mờ 3 mức, dấu xóa, chỉ lưu mã nguồn (không lưu thư viện / build), chính sách xung đột, hạn mức — script tự kiểm từng kỳ vọng |
| `make seed-big` | + file 33MB đi đường file rời (blob) |
| `make reset-db` | **Xóa** `data/` rồi nạp lại mẫu (dừng server trước) |

Tùy chọn: `python3 scripts/init_db.py --data-dir /tmp/x --seed`.

## Sandbox Docker

```bash
make image        # build sandbox-kit/sandbox:w2 (python:3.12-slim + git + curl + trình thực thi gRPC)
make run-docker   # server dùng provider Docker (mặc định là bộ giả lập "fake")
make test-docker  # test trên Docker thật (bộ test thường tự bỏ qua khi thiếu Docker/image)
```

| Biến môi trường | Mặc định | Ý nghĩa |
| :--- | :--- | :--- |
| `SANDBOX_KIT_PROVIDER` | `fake` | `fake` (trong bộ nhớ) hoặc `docker`; giá trị lạ → dừng ngay lúc khởi động |
| `SANDBOX_KIT_SANDBOX_IMAGE` | `sandbox-kit/sandbox:w2` | Image dùng khi bật sandbox |
| `SANDBOX_KIT_SANDBOX_NETWORK` | `true` | `false` → container không ra mạng (khi đó chưa chạy lệnh được) |
| `SANDBOX_KIT_FAKE_EXEC_HOST` | `false` | bộ giả lập: `true` → `command_run` chạy lệnh THẬT trên máy host (không cô lập — chỉ dev/test) |
| `SANDBOX_KIT_COMMAND_TIMEOUT_DEFAULT` / `_MAX` | `120` / `600` | giới hạn thời gian mỗi lệnh (giây) |
| `SANDBOX_KIT_POLICY_MODE` / `_POLICY_LAYER2_MODE` | `audit` / `audit` | bộ chặn lớp 1 / lớp 2: `audit` (cảnh báo) hoặc `enforce` (chặn) |

Mỗi sandbox = 1 container `skc-…` + 1 volume `skc-vol-{session}` gắn `/workspace`, mang label
`sandbox-kit=1`. Khi bật, toàn bộ file trong VFS được xuất ra volume (đánh dấu `synced_sha256`,
mốc đồng bộ = revision hiện tại). Dừng = xóa cả container lẫn volume — file trong kho không mất.
Container chạy trình thực thi gRPC (`python -m sandbox_kit_clone.agent`, cổng 50051 chỉ ánh xạ ra
`127.0.0.1`); `command_run` gửi lệnh `bash -lc` vào đó, output về dần theo thời gian thực.
`/scratch` là tmpfs 256MB. Sửa `agent/proto/sandbox_agent.proto` → `make proto` rồi `make image`.
Trước mỗi lệnh, thay đổi trong kho (ghi / sửa / xóa qua MCP) được tự đẩy vào sandbox và sandbox xác
nhận từng file; chưa xong → `sync_unavailable`, lệnh không chạy. Bộ chặn lệnh 2 lớp kiểm lệnh trước
(lớp 1 lệnh phá hoại, lớp 2 shell tự ghi/xóa file) — mặc định chỉ cảnh báo, `enforce` để chặn hẳn.
**Chưa có (tuần 3):** nhận file do lệnh tạo / sửa trong sandbox về kho.

## Giao diện quản trị (dev tool)

Một trang duy nhất `/admin` (React, theme sáng) — sidebar 3 mục:

- **Tổng quan** — dashboard (workspace/phiên/sandbox), console gọi thử 14 tool MCP qua
  `/mcp` (form sinh theo metadata, chọn phiên dùng chung), tải lên/tải xuống (file lớn
  tự đi đường chunk).
- **VFS** — quản lý kho file: danh sách workspace + hạn mức, cây file (nhãn blob / nhị phân),
  sửa & lưu (Ctrl+S), sửa khớp mờ (old_text tự lấy từ file hoặc đoạn đang chọn) có xem trước
  diff, đổi tên, xóa, upload (file lớn tự đi đường chunk), lịch sử có diff + khôi phục, dấu xóa,
  sổ thao tác, tab **Thuật toán** chạy thử chuẩn hóa đường dẫn / quy tắc không lưu / khớp mờ mà
  không ghi gì. Phím tắt: `N` file mới, `R` tải lại.
- **Sandbox** — quản lý sandbox: bật (TTL / CPU / RAM) · tạm dừng · tiếp tục · gia hạn ·
  dừng & xóa theo từng phiên; cảnh báo "lệch sổ" khi trạng thái ghi trong DB khác thực tế; danh sách
  sandbox mồ côi + nút dọn; chi tiết container (cổng, volume, giới hạn, CPU/RAM), duyệt và đọc file
  trong `/workspace`, xem log, **khung chạy lệnh** (output hiện dần, Enter để chạy, ↑/↓ lịch sử),
  trạng thái đồng bộ, nút đồng bộ ngay / đồng bộ lại toàn bộ / so sánh kho ↔ sandbox, kiểm tra lệnh
  với bộ chặn mà không chạy. Tự làm mới mỗi 5 giây.

Mã nguồn UI ở `web/` (Vite + React + TS; `features/overview|vfs|sandbox`, design tokens ở
`web/src/styles/tokens.css`); build vào `web/dist` — server phục vụ thẳng. Route cũ
`/admin/vfs`, `/admin/sandboxes` chuyển hướng về `/admin`. REST `/admin/api/*` **không có
trong OpenAPI, không xác thực — chỉ chạy ở localhost**.

## Kết nối MCP Inspector

```json
{
  "mcpServers": {
    "sandbox-kit": { "type": "streamable-http", "url": "http://127.0.0.1:8000/mcp" }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http sandbox-kit http://127.0.0.1:8000/mcp
```

## Bộ tool

| Tool | Chức năng |
| :--- | :--- |
| `workspace_create` | Tạo dự án + phiên làm việc (sinh mã tự động) |
| `file_write` / `file_read` / `file_edit` / `file_delete` / `file_list` | Ghi / đọc / sửa (khớp mờ) / xóa (dấu vết) / liệt kê |
| `sandbox_start` / `sandbox_stop` / `sandbox_pause` / `sandbox_resume` / `sandbox_renew` / `sandbox_status` | Vòng đời sandbox |
| `command_run` | Chạy lệnh shell trong sandbox — output gửi dần (log notification), timeout, kết quả chuẩn hóa |
| `sync_status` | Trạng thái đồng bộ kho ↔ sandbox (W3 hoàn thiện) |

## Lưu ý

- File lớn hơn ~3MB không đi qua `file_write`: dùng `POST /upload` → `PUT /upload/{token}`
  (từng chunk) → `POST /upload/{token}/complete`; đọc qua URL trong `download_url`.
- Kho chỉ lưu mã nguồn mà dự án đẩy lên GitHub: thư viện, môi trường ảo, cache, build
  (`node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `dist/`, `build/`, `*.egg-info/`, `.git/`, `*.pyc`,
  `.DS_Store`... — danh sách ở `vfs/ignore.py`) bị từ chối với `ignored_path`, không có ngoại lệ.
- Toàn bộ dữ liệu nằm trong `data/`
  (`system.sqlite`, `workspaces/`, `staging/`, `fake-sandboxes/`) — xóa thư mục này để reset.
