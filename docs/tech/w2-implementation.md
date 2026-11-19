# W2 — Báo cáo triển khai (as-built, đang làm)

> **Trạng thái:** đang làm — phần 1/3: **quản lý sandbox container**. Chưa có trình thực thi
> gRPC, `command_run`, bộ chặn lệnh.

## 1. Đã làm

| Hạng mục | File | Ghi chú |
| :--- | :--- | :--- |
| Provider Docker | `providers/docker.py` | container + named volume `/workspace`; create/start/terminate/pause/resume/renew, `prepare_workspace` qua container tạm + `put_archive`, `get_dial_target`, `list_sandboxes` theo label; tùy chọn: `describe_sandbox`, metrics, log, liệt kê/đọc file `/workspace` |
| Chọn provider | `providers/factory.py`, `config.py` | `SANDBOX_KIT_PROVIDER=fake\|docker`; giá trị lạ → `ValueError` lúc khởi động; Docker không kết nối được → `provider_unavailable` |
| Nạp file khi bật sandbox | `manager/manager.py` (`_export_workspace`) | VFS → `data/materialize/{session}/` → provider chép vào volume → xóa thư mục tạm; đặt `synced_sha256`; `sync_state = synced`, mốc = revision hiện tại (design-01 §6.1) |
| Quản trị sandbox | `manager.sandbox_overview/detail/terminate_orphan` | ghép phiên (system DB) với sandbox thật; `drift` khi sổ ghi RUNNING/PAUSED mà thực tế khác; sandbox mồ côi |
| REST + trang | `gateway/admin_sandbox_api.py`, `gateway/sandbox.html` | `/admin/sandboxes`; không xác thực, chỉ localhost |
| Image | `sandbox-image/Dockerfile` | `python:3.12-slim` + git, curl; tạm thời `sleep infinity` |

## 2. Quyết định triển khai

| # | Quyết định | Lý do |
| :--- | :--- | :--- |
| B1 | Hạn sống lưu ở label `sandbox-kit.expires-at`; `renew` ghi đè trong bộ nhớ provider | label không sửa được sau khi tạo; system DB vẫn là nguồn chính (`sessions.expires_at`) |
| B2 | Cổng trình thực thi `50051/tcp` ánh xạ ra `127.0.0.1:<ngẫu nhiên>`; chưa có mTLS | PoC một máy; mTLS (mcp-integration §3.9) để sau |
| B3 | Mặc định cho container ra mạng (`SANDBOX_KIT_SANDBOX_NETWORK`) | build cần tải gói; tắt được bằng env |
| B4 | Dừng sandbox = xóa container **và** volume | §8 "dọn bộ nhớ ngoài"; dữ liệu đã nằm trong VFS |
| B5 | `/scratch` = tmpfs 256MB | §5.1: bộ nhớ tạm chỉ trong RAM |

## 3. Kiểm chứng

- `tests/test_sandbox_admin.py` (bộ giả lập): nạp file, vòng đời qua REST, lệch sổ, dọn mồ côi.
- `tests/test_docker_provider.py` (`-m docker`, Docker thật): vòng đời + file nhị phân, đọc file khi
  container tạm dừng, gia hạn, dọn volume, mồ côi, báo lỗi rõ khi thiếu image.
- Chrome headless trên `/admin/sandboxes` với Docker thật: bật → xem file → tạm dừng → tiếp tục →
  gia hạn → dừng & xóa; không lỗi JS, không sót container/volume; vừa màn hình điện thoại.
