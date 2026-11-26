# W3 — Báo cáo triển khai (as-built, đang làm)

> **Trạng thái:** xong 2 mảng đầu việc tuần 3 — (1) giao diện quản trị tách trang Thao tác/Quản lý
> kèm điều hướng, (2) đồng bộ nhận về kho (pull-back) theo mô hình checkout/check-in kèm guard
> chống mất dữ liệu. **Gate W3 đạt:** lệnh tạo file trong sandbox → pull → file có trong VFS,
> revision tăng, push không gửi ngược lại (không ping-pong) — test trên bộ giả lập; 183 test pass,
> ruff sạch, đã push GitHub (`b11f69e`, `8c01f48`).

## 1. Đã làm

### 1a. Giao diện quản trị (React, theme sáng)

| Hạng mục | File | Ghi chú |
| :--- | :--- | :--- |
| Tách trang Thao tác/Quản lý | `web/src/App.tsx`, `features/vfs/Vfs{Ops,Manage}Page.tsx`, `features/sandbox/Sandbox{Ops,Manage}Page.tsx` | sidebar 5 trang: Tổng quan \| VFS (Thao tác, Quản lý) \| Sandbox (Thao tác, Quản lý); Quản lý = chỉ hiển thị thông tin, Thao tác = nơi làm mọi thao tác |
| Điều hướng kèm đối tượng | `web/src/lib/nav.ts` | hợp đồng điều hướng đơn nguồn: `VfsOpsRequest {workspaceId?, file?, nonce}`, `VfsManageRequest`, `SandboxOpsRequest {sessionId, nonce}`; bấm item ở Quản lý → nhảy sang Thao tác đúng item đó; nonce để bắt cả lần trùng giá trị |
| VFS · Thao tác đầy đủ | `VfsOpsPage.tsx`, `WorkspaceInfoBar.tsx`, `RecentOps.tsx`, `DirtyDiffModal.tsx` | thanh thông tin workspace (policy, hạn mức, phiên), "Sang Sandbox" khi có phiên RUNNING/PAUSED, sổ thao tác gần đây, "+ Workspace" (modal tạo), xem diff chưa lưu, nút "Lịch sử"/"Xem thay đổi" trong editor |
| Lịch sử file tại chỗ | `FileEditor.tsx` + tái dùng `HistoryPanel` | modal "Lịch sử chỉnh sửa — {path}" ngay trong trang Thao tác: danh sách revision, xem diff từng bản, khôi phục (có xác nhận) — không phải nhảy sang Quản lý |
| Sandbox · Thao tác đầy đủ | `SandboxOpsPage.tsx` | cột trái gồm cả phiên STANDBY ("chưa bật"); bật sandbox (modal TTL/CPU/RAM), Tạm dừng/Tiếp tục/Gia hạn/Dừng & xóa; tabs Chạy lệnh / File / Log / Đồng bộ / Kiểm tra lệnh / Thông tin container |
| Sync UI | `SyncPanel.tsx`, `sandboxApi.ts`, `types.ts` | nút **"Nhận về kho"** (pull) kèm kết quả applied/conflicts/failures; banner cảnh báo khi dừng sandbox bị chặn + nút "Dừng & bỏ thay đổi" (force) |

### 1b. Đồng bộ nhận về kho (pull-back)

| Hạng mục | File | Ghi chú |
| :--- | :--- | :--- |
| Giao thức | `agent/proto/sandbox_agent.proto` | RPC `PullFiles` (server-stream): Manager gửi danh sách path → agent stream từng file `FileStart (path/size/sha256)` → data ≤1MB → `FileEnd`; path không đọc được → `Missing`, không làm hỏng file khác |
| Agent trong container | `agent/server.py` `PullFiles` | `_resolve_file` (chặn `..`/symlink thoát ra ngoài) → tính sha256 trước → stream theo đoạn 1MB; chỉ phụ thuộc grpc + protobuf |
| Client Manager | `manager/exec_client.py` | `pull(paths) -> Iterator[PulledFile(path, size, sha256, error, chunks())]`; gom event theo file, lỗi kênh → `agent_unavailable` |
| Phân loại pull | `sync/workspace_sync.py` `pull()` | baseline = **`synced_sha256` per-file** (không dùng watermark — nó cố tình lag): `sb==vfs` → đánh dấu synced; `sb==synced` → kho đi trước, bỏ qua; `vfs==synced` → chỉ sandbox đổi → nhận về; cả hai ≠ → xung đột; only_sandbox → file mới của agent → nhập; file đã push mà vắng trong sandbox → tombstone `origin="sandbox"` |
| Chính sách xung đột | `workspace_sync.pull()` + `vfs.conflict_policy` | đọc `conflict_policy` từ `workspace_meta` (lưu từ W1, giờ dùng thật): `sandbox_wins` → xung đột xử theo sandbox (nhập đè / xóa kho); `error` → hủy toàn bộ pull, trả danh sách xung đột cho caller/UI |
| Nhận nội dung | `workspace_sync.pull()` | verify `sha256(content) == pf.sha256` **trước khi ghi** → `vfs.write_file` + `set_synced_sha` (file ≥ ngưỡng tự vào blob sidecar); path thuộc vùng ignore → bỏ qua |
| Guard trước push | `workspace_sync.push()` | trước khi gửi put/delete: so sha sandbox với baseline — sandbox đã sửa file sắp bị đè → `error`: chặn cả push (`conflict`, không gửi gì); `sandbox_wins`: bỏ path đó (bản sandbox thắng, sẽ về kho qua pull); `full=True` bỏ qua guard (sửa chữa = kho thắng) |
| Manager | `manager/manager.py` | `sync_pull(session_id)` (yêu cầu RUNNING; PAUSED không pull được — agent đóng băng); **`sandbox_stop(session_id, force=False)`**: pull bắt buộc trước khi hủy — thất bại → từ chối stop (sandbox + volume còn nguyên), `force=true` mới bỏ thay đổi; PAUSED → bỏ qua pull (ghi rõ trong kết quả) |
| Fix `in_sync` | `manager.sandbox_compare` | trước đây chỉ tính `differ` + `only_vfs` — bỏ quên `only_sandbox` (báo "đồng bộ" dù sandbox có file kho không có); đã tính cả 3 |
| REST + MCP | `gateway/admin_sandbox_api.py`, `gateway/mcp_server.py` | `POST /admin/api/sessions/{id}/pull`; stop nhận `?force=true`; tool MCP `sync_pull` + docstring `sandbox_stop` mô tả gate |
| Vệ sinh seed | `providers/docker.py`, `providers/fake.py` | `prepare_workspace`: volume/thư mục cũ còn tồn tại → **xóa hẳn rồi tạo mới** trước khi seed (file ma từ lần chạy trước sẽ "sống dậy" và lấn át seed); `_remove_volume` chịu lỗi "in use" (retry + force) |

## 2. Quyết định triển khai

| # | Quyết định | Lý do |
| :--- | :--- | :--- |
| W3-1 | Chọn mô hình **checkout/check-in** thay vì đồng bộ 2 chiều thật (merge/CRDT) | 1 agent/1 sandbox/1 workspace, tiến trình đơn: pull là giao dịch một chiều, ghi xong tự cập nhật baseline → **không có vòng lặp theo cấu trúc**; merge ngữ nghĩa là overkill cho PoC — quay lại chỉ khi nhiều sandbox cùng ghi một workspace |
| W3-2 | Baseline xung đột = **`synced_sha256` per-file**, không dùng watermark | `synced_sha256` chỉ ghi sau ack thật từng file (Tx-A) — phản ánh chính xác sandbox đang có gì kể cả khi push dở; watermark cố tình lag → dùng nó sẽ phân loại sai |
| W3-3 | Pull kích hoạt ở **3 thời điểm**: nút manual + REST/MCP, bắt buộc trước stop, guard trước push | pull giữa chừng task tạo churn + xung đột giả; quét sha256 toàn bộ `/workspace` mỗi exec là lãng phí; không làm sync định kỳ/watch |
| W3-4 | Chỉ triển khai `sandbox_wins` \| `error` (đủ theo schema W1), chưa thêm `vfs_wins` | giới hạn phạm vi; `error` là mặc định an toàn nhất cho PoC — surfaced lên UI để người dùng tự quyết |
| W3-5 | `full=True` (đồng bộ lại toàn bộ) **bỏ qua guard** | ý đồ rõ ràng là sửa chữa — kho thắng; guard trên full push sẽ vô hiệu hóa chính nó |
| W3-6 | `sandbox_wins` ở guard push = **bỏ path** khỏi push (không phải đè bằng kho) | nhất quán với nghĩa "sandbox thắng": bản sandbox giữ nguyên, thay đổi của nó về kho qua pull; thay đổi kho ở path đó được ghi đè khi pull nhập |
| W3-7 | Stop khi **PAUSED** bỏ qua pull (agent đóng băng, gRPC không trả lời) | không thể pull; ghi `"pulled": {"skipped": "paused"}` để caller biết; dữ liệu vẫn an toàn vì volume chưa xóa |
| W3-8 | `wait_ready` khi stop-pull chỉ **15s** (thay vì 90s) | stop không được treo lâu; agent chết giữa chừng → pull fail → lộ `force` |
| W3-9 | 2-Tx (Tx-A dự án / Tx-B hệ thống) **giữ nguyên không gộp** | thiết kế đúng: commit-sau-ack, chạy lại vô hại; hệ quả duy nhất là watermark lag → lần sau gửi lại nhiều hơn — vô hại; gộp qua 2 DB không làm được |
| W3-10 | Pull nhận nội dung qua `write_file` (buffer RAM) | PoC: artifact agent thường nhỏ; hạn chế ghi rõ trong docstring — streaming thẳng vào sidecar để sau nếu cần |
| W3-11 | Ghi đè im lặng (đè file sandbox đang khác baseline) là lỗ hổng mất dữ liệu thật → guard là **P0** của tuần | trước W3: admin sửa VFS → push kế đè luôn bản agent đang sửa mà không báo |
| W3-12 | Nội dung pull là file mới (only_sandbox) **không tính là xung đột** | không đè gì của kho — luôn nhập an toàn kể cả khi policy `error` |

## 3. Kiểm chứng

- `tests/test_exec_agent.py`: `PullFiles` stream đúng thứ tự/sha/nội dung (file nhỏ + file >1MB
  nhiều đoạn), `chunks()` gọi đúng một lần; path không tồn tại / chứa `..` → `Missing`, file khác
  vẫn nhận đủ.
- `tests/test_sync_push.py` (19 test): pull import file mới (synced=sha, revision tăng), pull khi
  chỉ sandbox sửa, `error` chặn modify_vs_modify (VFS nguyên vẹn kể cả phần không conflict),
  `sandbox_wins` đè VFS, delete_vs_modify (parametrize 2 policy), tombstone `origin="sandbox"`,
  **không ping-pong** (`push_candidates` không chọn lại file vừa nhận); guard: `error` chặn toàn bộ
  push, `sandbox_wins` bỏ path bị guard nhưng vẫn gửi file khác, `full=True` bỏ qua guard, file mới
  của kho không bị guard chặn.
- `tests/test_gateway_e2e.py`: `sync_pull` qua Manager với **pull thật** (stub client); stop chặn
  khi pull thất bại (sandbox còn nguyên, `force=True` mới hủy), thứ tự **pull → terminate**;
  `in_sync` tính cả `only_sandbox` (kể cả ca chống âm tính giả).
- `tests/test_sandbox_admin.py`: endpoint pull 200 + đúng summary; stop truyền `force` đúng xuống
  Manager.
- `tests/test_docker_provider.py` / `tests/test_providers_fake.py`: volume cũ có file lạ →
  `prepare_workspace` dọn sạch rồi seed lại (Docker thật trên daemon).
- Tổng: `PYTHONPATH=src python -m pytest tests/ -q` → **183 passed**; `ruff check src tests` → sạch;
  `cd web && npm run build` (tsc strict + vite) → exit 0; `make image` rebuild
  `sandbox-kit/sandbox:w2` với RPC mới.
- Đã commit + push GitHub (`main`): `b11f69e` (W3 pull-back + guard), `8c01f48` (giao diện tách
  trang + điều hướng).
