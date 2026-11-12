# Sandbox Kit Clone (W1 PoC)

Nền tảng cho AI agent lập trình làm việc trên code qua MCP — VFS (SQLite) là kho lưu trữ
trung tâm, sandbox chạy qua provider (PoC dùng bộ giả lập).

## Cấu trúc

```
src/sandbox_kit_clone/
├── config.py, errors.py, main.py    # cấu hình, bộ lỗi chuẩn, điểm vào server
├── vfs/        # kho file: core (VFS), schema, blob, fuzzy, ignore, quota, paths
├── system/     # DB hệ thống: schema + SystemStore (workspaces/sessions/ops)
├── providers/  # ABC SandboxProvider + FakeProvider (in-memory)
├── manager/    # Manager: điều phối workspace/session/sandbox
└── gateway/    # FastAPI app: MCP mount /mcp, upload/download, health
scripts/smoke_mcp_client.py        # smoke test bằng MCP client SDK thật
```

## Chạy nhanh

```bash
make test; make lint   # pytest (56 test) + ruff check src tests
make run      # server tại http://127.0.0.1:8000
python3 scripts/smoke_mcp_client.py    # smoke qua MCP thật (server phải đang chạy)
```

MCP endpoint: `http://127.0.0.1:8000/mcp` (transport streamable-http, stateless).

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
| `sync_status` | Trạng thái đồng bộ kho ↔ sandbox (W3 hoàn thiện) |

## Lưu ý

- File lớn hơn ~3MB không đi qua `file_write`: dùng `POST /upload` → `PUT /upload/{token}`
  (từng chunk) → `POST /upload/{token}/complete`; đọc qua URL trong `download_url`.
- Ghi vào thư mục ignore (`node_modules`, `.venv`...) bị chặn mặc định; `force=true` cho phép
  nhưng file sẽ bị "đóng băng" với đồng bộ sau này. Toàn bộ dữ liệu nằm trong `data/`
  (`system.sqlite`, `workspaces/`, `staging/`, `fake-sandboxes/`) — xóa thư mục này để reset.
