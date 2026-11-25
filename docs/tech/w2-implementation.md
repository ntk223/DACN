# W2 — Báo cáo triển khai (as-built, đang làm)

> **Trạng thái:** xong 5/5 đầu việc tuần 2 — provider Docker, trình thực thi gRPC (chạy lệnh, nhận
> file, báo danh sách file), đẩy thay đổi VFS → sandbox trước mỗi lệnh, `command_run`, bộ chặn lệnh
> 2 lớp (audit). **Gate W2 đạt:** ghi file qua MCP (cả sau khi bật sandbox) → file có trong sandbox
> → lệnh đọc được — test trên bộ giả lập lẫn Docker thật.

## 1. Đã làm

| Hạng mục | File | Ghi chú |
| :--- | :--- | :--- |
| Provider Docker | `providers/docker.py` | container + named volume `/workspace`; create/start/terminate/pause/resume/renew, `prepare_workspace` qua container tạm + `put_archive`, `get_dial_target`, `list_sandboxes` theo label; tùy chọn: `describe_sandbox`, metrics, log, liệt kê/đọc file `/workspace` |
| Chọn provider | `providers/factory.py`, `config.py` | `SANDBOX_KIT_PROVIDER=fake\|docker`; giá trị lạ → `ValueError` lúc khởi động; Docker không kết nối được → `provider_unavailable` |
| Nạp file khi bật sandbox | `manager/manager.py` (`_export_workspace`) | VFS → `data/materialize/{session}/` → provider chép vào volume → xóa thư mục tạm; đặt `synced_sha256`; `sync_state = synced`, mốc = revision hiện tại (design-01 §6.1) |
| Quản trị sandbox | `manager.sandbox_overview/detail/terminate_orphan` | ghép phiên (system DB) với sandbox thật; `drift` khi sổ ghi RUNNING/PAUSED mà thực tế khác; sandbox mồ côi |
| REST + trang | `gateway/admin_sandbox_api.py`, `gateway/sandbox.html` | `/admin/sandboxes`; không xác thực, chỉ localhost |
| Image | `sandbox-image/Dockerfile` | `python:3.12-slim` + git, curl + grpcio/protobuf; tiến trình chính = trình thực thi |
| Giao thức | `agent/proto/sandbox_agent.proto` | `Exec` (server-stream: Output{stdout\|stderr, bytes} … Exit{exit_code, timed_out, duration_ms, error}), `SyncFiles` (client-stream: FileStart / data ≤1MB / FileEnd / Delete → xác nhận TỪNG thao tác kèm sha256), `ListFiles` (đường dẫn, kích thước, sha256; bỏ thư mục chỉ định), `Healthcheck`; code sinh bằng `make proto`, được commit |
| Nhận file trong agent | `agent/server.py` `SyncFiles` | ghi file tạm cùng thư mục → kiểm kích thước + sha256 → `os.replace` (nguyên tử); chặn đường dẫn tuyệt đối / `..` / thư mục cha là symlink ra ngoài; xóa thứ không có = ok (chạy lại an toàn); một file lỗi không ảnh hưởng file khác |
| Đẩy VFS → sandbox | `sync/workspace_sync.py`, `vfs.push_candidates/read_for_push/set_synced_many` | trước mỗi `command_run`: R = revision; R == mốc và `synced` → bỏ qua; gửi file có `synced_sha256 ≠ sha256` + dấu xóa `rev > mốc` (file đã ghi lại thì không xóa); đủ xác nhận → Tx-A `synced_sha256`, Tx-B mốc = R, `synced`; thiếu → `stale`, giữ mốc, **lệnh không chạy** (`sync_unavailable`), lần sau chỉ gửi phần thiếu; khóa theo sandbox; file rời gửi theo luồng; `full=True` gửi lại toàn bộ |
| So sánh kho ↔ sandbox | `manager.sandbox_compare` | `ListFiles` + sha256 → khớp / khác / chỉ có trong kho / chỉ có trong sandbox (bỏ vùng không lưu) |
| Bộ chặn lệnh 2 lớp | `policy/command_policy.py` | lớp 1: 10 quy tắc lệnh phá hoại (`rm -rf /`, mkfs, dd vào thiết bị, fork bomb, `curl \| sh`, chmod -R /, shutdown, kill -1...); lớp 2: 8 quy tắc shell tự ghi/xóa file (rm, mv, `sed -i`, `>`/`>>`, tee, truncate, git clean/reset --hard, find -delete). Lớp 2 bỏ phần trong nháy; lớp 1 quét cả chuỗi gốc (bắt `bash -c 'rm -rf /'`). Chế độ mỗi lớp `audit`/`enforce` (`SANDBOX_KIT_POLICY_MODE`, `SANDBOX_KIT_POLICY_LAYER2_MODE`); ghi vết 3 lớp: sổ thao tác + cảnh báo trong kết quả tool + log `sandbox_kit_clone.policy` |
| Trình thực thi | `agent/server.py`, `python -m sandbox_kit_clone.agent` | `bash -lc` trong `/workspace` (cwd con được, chặn thoát ra ngoài); output gửi ngay từng đoạn ≤64KB; hết giờ → SIGTERM rồi SIGKILL **cả nhóm tiến trình**; client hủy → kill; chỉ phụ thuộc grpc + protobuf |
| Exec client | `manager/exec_client.py` | 1 channel/sandbox; chờ sẵn sàng tối đa 90s → `agent_unavailable`; mất kết nối trước khi nhận output → nối lại đúng 1 lần; giữ 1MB **cuối** mỗi luồng |
| `command_run` | `manager.command_run`, tool MCP, `POST /admin/api/sessions/{id}/exec` | phiên phải RUNNING; timeout mặc định 120s, tối đa 600s; ghi sổ thao tác; MCP gửi dần output bằng log notification (logger `stdout`/`stderr`, ~0,2s/lần); REST trả NDJSON cho trang quản trị |
| Bộ giả lập chạy lệnh | `FakeProvider(exec_host=True)`, `SANDBOX_KIT_FAKE_EXEC_HOST` | chạy trình thực thi THẬT trên host, gốc = thư mục volume giả — để test không cần Docker; **không cô lập**, mặc định tắt |

## 2. Quyết định triển khai

| # | Quyết định | Lý do |
| :--- | :--- | :--- |
| B1 | Hạn sống lưu ở label `sandbox-kit.expires-at`; `renew` ghi đè trong bộ nhớ provider | label không sửa được sau khi tạo; system DB vẫn là nguồn chính (`sessions.expires_at`) |
| B2 | Cổng trình thực thi `50051/tcp` ánh xạ ra `127.0.0.1:<ngẫu nhiên>`; chưa có mTLS | PoC một máy; mTLS (mcp-integration §3.9) để sau |
| B3 | Mặc định cho container ra mạng (`SANDBOX_KIT_SANDBOX_NETWORK`) | build cần tải gói; tắt được bằng env |
| B4 | Dừng sandbox = xóa container **và** volume | §8 "dọn bộ nhớ ngoài"; dữ liệu đã nằm trong VFS |
| B5 | `/scratch` = tmpfs 256MB | §5.1: bộ nhớ tạm chỉ trong RAM |
| B6 | Kênh gRPC không mã hóa (insecure), chưa mTLS | chỉ mở ở 127.0.0.1; mTLS theo mcp-integration §3.9 để sau |
| B7 | Gửi dần output qua **log notification** MCP thay vì progress | progress cần client gửi progressToken; log notification client nào cũng nhận được |
| B8 | Đẩy trước lệnh dùng **delta** (`synced_sha256 ≠ sha256` + dấu xóa sau mốc) ngay từ W2 thay vì "gửi trọn bộ" | rẻ và đúng thiết kế design-01 §6.2; "gửi trọn bộ" vẫn có qua `sync_push(full=True)` / nút "Đồng bộ lại toàn bộ" |
| B11 | `synced_sha256` theo file, không theo sandbox | PoC 1 phiên/workspace; nhiều sandbox song song cho một workspace cần mốc theo sandbox |
| B12 | Chưa có đường dự phòng `provider.sync_files` (put_archive) | agent không phản hồi → `agent_unavailable` / `sync_unavailable` |
| B13 | Quyền file (chmod +x) không giữ khi đẩy | VFS không lưu mode — script cần `bash script.sh` |
| B14 | Bộ chặn lệnh theo mẫu regex | chặn thao tác lỡ tay / phổ biến, không thay cô lập container; lệnh cố tình né mẫu vẫn lọt |
| B9 | Container không mạng (`SANDBOX_KIT_SANDBOX_NETWORK=false`) → không có cổng → `command_run` báo `capability_unavailable` | cần kênh khác (docker exec / unix socket) — để sau |
| B10 | Chưa có `command_interrupt`; dừng lệnh = hết timeout hoặc client hủy | §4.2 mcp-integration |

## 3. Kiểm chứng

- `tests/test_sandbox_admin.py` (bộ giả lập): nạp file, vòng đời qua REST, lệch sổ, dọn mồ côi.
- `tests/test_docker_provider.py` (`-m docker`, Docker thật): vòng đời + file nhị phân, đọc file khi
  container tạm dừng, gia hạn, dọn volume, mồ côi, báo lỗi rõ khi thiếu image.
- `tests/test_exec_agent.py`: agent local (exit code, gửi dần, kill cả nhóm khi hết giờ, cwd/env,
  cắt output), `command_run` qua Manager / REST NDJSON / **transport MCP thật** (log notification tới
  client trước khi lệnh xong), gate "ghi qua MCP → lệnh đọc được".
- `tests/test_command_policy.py` (43 ca): 16 lệnh phá hoại, 12 lệnh shell ghi file, 15 lệnh thường
  không bị báo nhầm, chế độ enforce theo lớp.
- `tests/test_sync_push.py`: SyncFiles xác nhận từng thao tác (sha sai, thoát đường dẫn, file 2,5MB,
  không sót file tạm), ListFiles; **gate W2 đầy đủ**; file rời; đẩy lỗi → stale + lệnh không chạy +
  lần sau chỉ gửi phần thiếu; enforce chặn + ghi sổ failed; đồng bộ lại toàn bộ + so sánh phát hiện lệch.
- `tests/test_docker_provider.py::test_push_before_command_in_container`: gate trên Docker thật.
- `tests/test_docker_provider.py::test_command_run_inside_container`: chạy lệnh trong container thật,
  gửi dần, timeout, tạm dừng/tiếp tục vẫn dùng lại kênh gRPC.
- Chrome headless trên `/admin/sandboxes` với Docker thật: bật → xem file → tạm dừng → tiếp tục →
  gia hạn → dừng & xóa; không lỗi JS, không sót container/volume; vừa màn hình điện thoại.
