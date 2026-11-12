# Sandbox Kit Clone — Tài liệu thiết kế hệ thống (chuẩn chỉ)

> **Trạng thái:** CANONICAL — tài liệu thiết kế chính thức của dự án; hợp nhất
> `mcp-integration.md` + `design/01-workspace-sync.md`, áp bộ quyết định C1–C8 (đối chiếu
> kiến trúc gốc `sandbox-kit` + phản biện độc lập, 2026-11-05). Bản này viết theo ngôn ngữ
> dễ đọc cho cả phía kỹ thuật lẫn quản lý: thuật ngữ chuyên môn giữ ở mức tối thiểu và luôn
> được giải thích tại chỗ. Chi tiết kỹ thuật sâu (giao thức, ma trận lỗi, bộ test): xem
> `design/01-workspace-sync.md`.
> **Dùng kèm:** `poc-plan.md` — kế hoạch PoC 5 tuần.

---

## 0. Tóm tắt điều hành

Hệ thống cho AI agent lập trình làm việc trên mã nguồn một cách an toàn: agent quản lý dự án,
đọc/ghi file, và chạy lệnh bên trong **sandbox** — môi trường cô lập, tách khỏi máy chủ. Điểm
cốt lõi: **mọi thay đổi đều hội tụ về một kho lưu trữ duy nhất** (kho file của dự án). File do
agent ghi và file do lệnh trong sandbox tạo ra (kết quả build, cài thư viện…) đều được đưa về
kho; sandbox chỉ là "bản sao làm việc" — bị xóa bất cứ lúc nào cũng không mất dữ liệu đã ghi
nhận.

Bản gốc `sandbox-kit` đã làm được nửa đầu (ghi file → kho lưu → đẩy phần thay đổi xuống
sandbox trước mỗi lệnh). Bản clone hoàn thiện nửa còn lại và nâng cấp ba điểm:

1. **Nhận ngược** file do sandbox sinh ra về kho lưu — bản gốc để chúng mất khi sandbox bị xóa.
2. **Phát hiện xung đột** khi agent và lệnh trong sandbox cùng sửa một file — bản gốc âm thầm
   ghi đè phía agent.
3. **Đổi giao diện sang MCP** — chuẩn kết nối phổ biến nhất hiện nay cho AI agent — thay cho
   REST thuần của bản gốc.

Và một quyết định khác biệt so với thiết kế cũ của chính dự án này: **bỏ lưu trữ đám mây
(S3)**. File nhỏ lưu ngay trong database của dự án; file lớn lưu thành file rời trên đĩa máy
chủ — giảm mạnh độ phức tạp vận hành, không phụ thuộc dịch vụ ngoài.

---

## 1. Phạm vi & mục tiêu

| # | Mục tiêu | Nguồn |
| :--- | :--- | :--- |
| 1 | AI agent thao tác với hệ thống qua MỘT giao diện duy nhất (MCP) | Yêu cầu đề bài |
| 2 | File do sandbox tạo ra được nhận về kho lưu — không mất khi sandbox chết | Vá khoảng trống P0#1 |
| 3 | Cả hai phía cùng sửa một file → phát hiện và xử lý có kiểm soát, không ghi đè âm thầm | Vá khoảng trống P0#2 |
| 4 | Logic đồng bộ tập trung một module duy nhất, tách khỏi phần còn lại | P1#6 |
| 5 | Ghi sổ mọi thao tác; chạy lại thao tác cho ra cùng kết quả | P1#7 / P1#10 |
| 6 | Chạy được trên nhiều hạ tầng: Docker, Kubernetes, bộ giả lập để test | Phạm vi đề bài |
| 7 | Kho file chỉ chứa file nguồn (không chứa thư viện phụ thuộc); mỗi dự án một file database riêng | Chỉ thị chủ dự án |

**Ngoài phạm vi PoC:** lưu trữ đám mây, giao diện dashboard, phân quyền đầy đủ (đăng nhập nhiều
tổ chức), tối ưu hiệu năng lớn, Git nâng cao (PoC chỉ làm mức cơ bản).

---

## 2. Nguyên tắc thiết kế (mười điều bất biến)

1. **Cửa vào mỏng.** Giao diện MCP chỉ nhận yêu cầu, xác định dự án, trả kết quả — mọi xử lý
   nằm ở các thành phần chuyên trách bên dưới.
2. **Kho file là nguồn sự thật; sandbox chỉ là bản xem.** Sandbox bị xóa bất cứ lúc nào cũng
   không mất dữ liệu đã ghi nhận.
3. **Mỗi file database chỉ một thành phần được phép ghi.** Database dự án ← kho file; database
   hệ thống ← bộ điều phối. Không có giao dịch trải qua hai file — ghi lần lượt 2 bước, an
   toàn vì thao tác chạy lại được.
4. **Kho file chỉ chứa file nguồn.** Thư viện phụ thuộc (`node_modules/`, `.venv/`…) không bao
   giờ được nạp vào qua đường tự động; agent cố ý ghi vào các thư mục này sẽ bị chặn, trừ khi
   đánh dấu "cho phép đè" một cách rõ ràng.
5. **File lớn không đi qua kênh nhắn tin với agent.** File trên ~3MB đi đường upload riêng —
   tránh nghẽn, tránh lỗi giao thức.
6. **Không dùng đám mây ở giai đoạn này.** File ≤ 32MB lưu trong database; lớn hơn lưu thành
   file rời trên đĩa. Sau này muốn chuyển lên đám mây, giao diện lưu trữ đã mở sẵn đường.
7. **Mốc đồng bộ chỉ cập nhật khi sandbox xác nhận đã nhận đủ file** — không cập nhật sớm làm
   che mất phần chưa gửi.
8. **Không giữ giao dịch database trong lúc chờ mạng.** Bước mạng luôn nằm giữa hai giao dịch
   ngắn.
9. **Chạy lại cho ra cùng kết quả.** Mỗi thao tác có mã định danh riêng; gửi trùng mã → hệ
   thống nhận ra và không làm đôi.
10. **Kế thừa nguyên tắc tốt của bản gốc:** Git ba tầng (database giữ hiện tại, Git remote giữ
    lịch sử, bản làm việc xóa được bất cứ lúc nào); thư mục tạm chỉ nằm trong RAM; khi gặp
    trạng thái lạ, ưu tiên an toàn.

---

## 3. Kiến trúc thành phần

```text
AI AGENT (Claude / Cursor / CI)
   │ MCP streamable HTTP (stateless) — JSON-RPC tools
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  APP PROCESS (PoC: 1 process Python; production: tách theo writer)     │
│                                                                        │
│  MCP GATEWAY ──facade mỏng──► SANDBOX MANAGER                          │
│   • resolve session→workspace       • lifecycle orchestration          │
│   • chuẩn hóa lỗi / auth opt-in     • └─ WORKSPACE SYNC (module)       │
│   • chunked HTTP upload/download    │     delta · push · pull · policy│
│                                     • operations tracking (system DB)  │
│  VFS ───────────────────────────►  workspace DB (mỗi dự án 1 file)     │
│   • files/revisions/tombstones      data/workspaces/{id}.sqlite        │
│   • fuzzy edit · git_meta           + blobs/{sha256} sidecar (≥32MB)   │
└────────────────────────────────────────────────────────────────────────┘
        │ SandboxProvider ABC                    ▲ gRPC: run / sync / manifest
        ▼                                        │
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ docker provider │   │ k8s provider    │   │ fake provider   │
│ (PoC chính)     │   │ (stretch PoC)   │   │ (conformance)   │
└─────────────────┘   └─────────────────┘   └─────────────────┘
        │ docker volume seed → /workspace        │
        ▼                                        ▼
   SANDBOX container: toolchain + EXEC AGENT (gRPC server, PID 1)
```

| Thành phần | Trách nhiệm | KHÔNG làm |
| :--- | :--- | :--- |
| **MCP Gateway** (cửa vào) | Nhận lệnh từ agent, xác định dự án, chuyển tiếp yêu cầu, trả kết quả chuẩn hóa, xác thực tùy chọn, nhận file lớn | Không chứa logic xử lý |
| **Sandbox Manager** (bộ điều phối) | Gọi đồng bộ đúng thời điểm (trước khi chạy lệnh, sau khi chạy, khi tạo sandbox, khi phục hồi); quản lý vòng đời sandbox; ghi sổ thao tác vào database hệ thống | Không tự ghi database dự án — mọi thay đổi file qua kho file |
| **Workspace Sync** (bộ đồng bộ) | Tính file nào thay đổi; đẩy vào sandbox; nhận về kho; xử lý xung đột; dọn dấu xóa | Không đụng vòng đời sandbox |
| **VFS** (kho file) | Lưu trữ thật — sở hữu database từng dự án; sửa file, lưu lịch sử, đánh dấu file đã xóa | Không biết sandbox tồn tại; không tự đồng bộ |
| **SandboxProvider** (lớp hạ tầng) | Tạo/xóa/tạm dừng sandbox trên Docker/Kubernetes/giả lập; cấp nơi chứa mã dự án; cho biết địa chỉ kết nối sandbox | Không tính file nào cần đồng bộ, không biết khái niệm "phiên bản file" |
| **Trình thực thi** (exec agent) | Chạy bên trong sandbox: nhận lệnh, nhận file, báo danh sách file hiện có | Không tự quyết xung đột; không nói chuyện trực tiếp với kho file |

**Cách triển khai PoC:** một tiến trình Python duy nhất chứa cả 4 thành phần trong hệ (cửa
vào, điều phối, đồng bộ, kho file) — quy tắc "mỗi database chỉ một người ghi" thỏa tự nhiên;
sandbox chạy trong Docker. Sau này cần mở rộng có thể tách thành nhiều tiến trình — miễn giữ
nguyên quy tắc trên.

---

## 4. Giao diện MCP

**Kết nối & khởi tạo:** agent kết nối qua giao thức MCP chuẩn (kiểu HTTP không trạng thái —
mở rộng ngang không cần cấu hình thêm). Tool đầu tiên `workspace_create` tự sinh mã dự án +
mã phiên làm việc; agent chỉ cần giữ mã phiên. Xác thực: mặc định bỏ qua (dùng nội bộ), bật
khóa API khi cần cho CI.

**Danh sách tool chính:**

| Tool | Chức năng | Ghi chú |
| :--- | :--- | :--- |
| `workspace_create` | Tạo dự án + phiên làm việc | sinh mã tự động |
| `sandbox_start` / `sandbox_stop` / `sandbox_status` | Bật / dừng / xem trạng thái sandbox | có tạm dừng, gia hạn thời hạn |
| `file_write` / `file_read` / `file_edit` / `file_delete` / `file_list` | Ghi / đọc / sửa / xóa / liệt kê file | sửa dùng khớp mờ; xóa để lại dấu vết |
| `command_run` | Chạy lệnh trong sandbox | đồng bộ chưa xong → báo lỗi, KHÔNG chạy |
| `sync_status` | Xem trạng thái đồng bộ | thấy được phần chưa gửi |
| `git_clone` / `git_commit` / `git_push` / `git_status` | Git cơ bản | PoC: mức cơ bản |

**File lớn (trên ~3MB):** lệnh ghi file chỉ gửi thông tin mô tả → hệ thống trả một địa chỉ
upload riêng; file truyền theo từng phần, an toàn với mạng chậm (tải dở được tiếp tục). Đọc
file lớn cũng tương tự với địa chỉ download. File lớn không bao giờ đi qua kênh nhắn tin
thông thường.

**Quan hệ dự án ↔ phiên làm việc:** một dự án có thể có nhiều phiên làm việc lần lượt theo
thời gian (phiên kết thúc thì dự án vẫn còn); một phiên tại một thời điểm chỉ thuộc một dự án.

---

## 5. Sandbox & hạ tầng chạy

### 5.1. Sandbox là gì
Sandbox = môi trường chạy lệnh cô lập, ngắn hạn, dựng từ image có sẵn, chứa đúng hai thứ: bộ
công cụ + mã dự án, và **trình thực thi** (chương trình nhỏ nhận lệnh từ bên ngoài). Bên
trong: `/workspace` = nơi chứa mã dự án (bền — là bản xem của kho file); `/tmp`, `/scratch` =
bộ nhớ tạm, mất khi sandbox chết; phần còn lại của image chỉ đọc.

### 5.2. Bộ khung Provider (lớp trừu tượng hạ tầng)

| Khả năng | Ý nghĩa |
| :--- | :--- |
| Tạo / xóa sandbox | Dựng mới từ image; hủy bỏ và dọn sạch |
| Tạm dừng / tiếp tục / gia hạn thời hạn | Quản lý sandbox đang sống |
| Chuẩn bị nơi chứa mã dự án | Sao chép mã nguồn vào bộ nhớ ngoài gắn vào sandbox |
| Cho biết địa chỉ kết nối | Hệ thống dùng địa chỉ này để nói chuyện với trình thực thi bên trong |
| Xem tài nguyên / chẩn đoán / cổng dịch vụ | Tùy chọn — không bắt buộc mỗi hạ tầng đều có |
| Liệt kê mọi sandbox đang sống | Phục vụ quét dọn sandbox mồ côi |

### 5.3. Ba hiện thực
- **Docker (chính của PoC):** container + volume riêng chứa mã dự án gắn vào `/workspace`;
  sao chép mã vào volume ngay khi tạo; trình thực thi lộ qua cổng ánh xạ.
- **Kubernetes (mở rộng PoC):** pod + ổ đĩa bền; địa chỉ kết nối = IP pod.
- **Bộ giả lập (cho test):** chạy trong bộ nhớ, cùng bộ khung — cho phép kiểm thử toàn bộ quy
  trình không cần Docker.

### 5.4. Vòng đời
`STANDBY → STARTING → RUNNING ⇄ PAUSED`; hết hạn → dọn dẹp. **Sandbox đang tạm dừng (PAUSED)
không bao giờ bị dọn theo thời hạn** (kế thừa bản gốc). Thông tin thời hạn lỗi hoặc không hợp
lệ → coi như chưa hết hạn (ưu tiên an toàn).

### 5.5. Trình thực thi (exec agent)
- Làm 4 việc: chạy lệnh (kết quả gửi về theo dòng), nhận file từ hệ thống (xác nhận từng
  file), báo danh sách file hiện có kèm "dấu vân tay" nội dung, gửi/nhận file lớn theo dòng.
- Kết nối: qua địa chỉ do provider cấp; mất kết nối → tự nối lại đúng một lần (che hết tình
  huống sandbox tạm dừng rồi tiếp tục); chờ kết nối tối đa 90 giây.
- Trình thực thi KHÔNG tự quyết xung đột, KHÔNG nói chuyện trực tiếp với kho file.

---

## 6. Lưu trữ & cấu trúc dữ liệu

### 6.1. Bố trí trên đĩa

```text
data/
├── workspaces/{id}.sqlite          ← database của từng dự án (kho file sở hữu)
├── workspaces/{id}/blobs/{sha256}  ← file rời cho file ≥ 32MB (ghi tạm → đổi tên)
├── staging/upload/{token}/…        ← nơi chứa tạm khi upload theo phần (tự dọn)
└── system.sqlite                   ← database hệ thống (bộ điều phối sở hữu)
```

### 6.2. Database dự án — mỗi dự án một file (kho file ghi độc quyền)

```sql
PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;

CREATE TABLE workspace_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  workspace_revision INTEGER NOT NULL DEFAULT 0,  -- đếm phiên bản dự án, tăng mỗi lần thay đổi file
  conflict_policy    TEXT NOT NULL DEFAULT 'sandbox_wins'  -- | 'error'
);

CREATE TABLE files (
  path TEXT PRIMARY KEY,
  content BLOB,                                   -- NULL khi file lưu rời
  size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  mtime TEXT NOT NULL, is_binary INTEGER NOT NULL DEFAULT 0,
  storage_class TEXT NOT NULL DEFAULT 'vfs',      -- 'vfs' | 'blob' (file rời ≥32MB)
  blob_ref TEXT,                                  -- tên file rời
  rev INTEGER NOT NULL,                           -- phiên bản lúc thay đổi cuối
  synced_sha256 TEXT                              -- "dấu vân tay" bản sao chắc chắn có trong sandbox
);
CREATE INDEX idx_files_rev ON files(rev);

CREATE TABLE file_revisions (                     -- lịch sử; tối đa 20 bản mỗi file
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL, patch TEXT NOT NULL,
  before_sha TEXT NOT NULL, after_sha TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE tombstones (                         -- dấu vết file đã xóa, chờ mọi sandbox xác nhận
  path TEXT PRIMARY KEY, rev INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  origin TEXT NOT NULL,                           -- xóa từ phía agent | xóa từ phía sandbox
  blob_ref TEXT
);

CREATE TABLE git_meta (                           -- khôi phục từ bản gốc (C6)
  id INTEGER PRIMARY KEY DEFAULT 1,
  head_commit TEXT, branch TEXT NOT NULL DEFAULT 'main', remote_url TEXT
);
```

### 6.3. Database hệ thống — một file toàn hệ thống (bộ điều phối ghi độc quyền)

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  sandbox_id TEXT, state TEXT NOT NULL,           -- STANDBY|STARTING|RUNNING|PAUSED
  expires_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE sync_state (
  sandbox_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  last_synced_revision INTEGER NOT NULL DEFAULT 0, -- mốc đồng bộ
  status TEXT NOT NULL DEFAULT 'syncing',          -- syncing | synced | stale
  updated_at TEXT NOT NULL
);
CREATE TABLE operations (                          -- sổ thao tác
  op_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,                 -- mã định danh — chạy lại không làm đôi
  workspace_id TEXT NOT NULL, sandbox_id TEXT,
  type TEXT NOT NULL, status TEXT NOT NULL,        -- running | success | failed
  result_digest TEXT, created_at TEXT NOT NULL
);
```

### 6.4. File rời cho file lớn & hạn mức (C1)
- File ≤ **32MB**: lưu thẳng trong database. Lớn hơn: ghi xuống file rời (ghi tạm → đổi tên
  an toàn), database chỉ giữ tham chiếu. Lý do: file quá lớn nằm trong database làm MỌI thao
  tác ghi chậm lại (phản biện độc lập đã chỉ ra).
- **Hạn mức mỗi dự án** (mặc định 2GB) — vượt → báo lỗi rõ ràng `quota_exceeded`. Dataset rất
  lớn là nhu cầu thật, nhưng phải từ chối có kiểm soát, không để hệ thống sập.
- Nơi chứa tạm khi upload được tự dọn (file chưa hoàn tất quá 24 giờ → xóa).
- Xóa dự án = xóa 2 thứ (database + thư mục file rời) — giải phóng toàn bộ dung lượng tức thì.

### 6.5. Bốn điều luôn đúng
1. Mốc đồng bộ của sandbox không bao giờ vượt quá phiên bản hiện tại của dự án.
2. File đang tồn tại trong sandbox ⟺ tồn tại trong kho lưu ở phiên bản đã đồng bộ (hoặc là
   dấu xóa đang chờ xác nhận).
3. Ghi file vào database dự án là "trọn gói" — không có trạng thái "nửa file".
4. Sổ thao tác là nơi duy nhất trả lời "việc gì đang/đã xảy ra" — không trạng thái quan trọng
   nào chỉ nằm trong bộ nhớ (khác bản gốc — bản gốc dùng bộ nhớ + file JSON).

---

## 7. Đồng bộ hai chiều: kho file ↔ sandbox

Chi tiết kỹ thuật (10 trường hợp phân loại, ma trận lỗi, 9 test chuẩn): xem
`design/01-workspace-sync.md`. Tóm lược theo ngôn ngữ dễ đọc:

### 7.1. Khi tạo sandbox mới
Sao chép toàn bộ file nguồn vào nơi chứa của sandbox (không qua kênh đồng bộ) → đánh dấu "đã
có bản sao" cho từng file → ghi mốc đồng bộ. File lớn lưu rời KHÔNG tải ngay — chỉ tải khi
lần chạy lệnh đầu tiên cần đến.

### 7.2. Trước mỗi lệnh (đẩy vào sandbox)
Tính phần thay đổi kể từ mốc đồng bộ (file sửa/thêm + file đã xóa) → gửi vào sandbox → sandbox
xác nhận từng file → cập nhật "đã có bản sao" → mới cập nhật mốc đồng bộ. **Nếu đồng bộ chưa
hoàn tất → lệnh bị từ chối với mã lỗi rõ ràng — KHÔNG chạy lệnh trên sandbox thiếu file, KHÔNG
nhận file về.** Đồng bộ trượt sẽ tự sửa ở lệnh kế tiếp (kế thừa hành vi của bản gốc).

### 7.3. Sau mỗi lệnh (nhận về kho)
Lấy danh sách file hiện có trong sandbox kèm "dấu vân tay" nội dung từng file → so với kho
lưu theo 10 trường hợp chuẩn → ghi phần thay đổi vào kho. Chỉ cập nhật trạng thái, KHÔNG đụng
mốc đồng bộ (mốc chỉ tiến ở bước xác nhận gửi — thiết kế chống mất dữ liệu chưa gửi).

### 7.4. Xung đột + chặn xóa hàng loạt (C7)
- Chính sách đặt theo từng dự án: **"sandbox thắng" (mặc định)** — nội dung do lệnh chạy
  trong sandbox được nhận về đè lên bản của agent, kèm cảnh báo rõ ràng cho agent; hoặc
  **"báo lỗi"** — dừng lại tại file xung đột, giữ nguyên bản của agent, để agent tự xử lý.
- **Chặn xóa hàng loạt:** nếu nhận về thấy nhiều file bị xóa cùng lúc (quá 20 file hoặc hơn
  30% tổng số file) → dừng, báo rõ, chờ xác nhận trước khi ghi nhận. Bản gốc không có nửa
  "nhận về" nên không cần lớp bảo vệ này — bản clone có và bắt buộc phải có.

### 7.5. Dấu xóa & dọn dẹp
File bị xóa không biến mất ngay mà để lại **dấu xóa**, đợi MỌI sandbox xác nhận đã thấy việc
xóa mới được dọn hẳn — cơ chế này làm việc "xóa nhầm do đồng bộ" không thể xảy ra (dọn chỉ
trễ, không bao giờ sớm).

### 7.6. Hai bước ghi an toàn
Mỗi thay đổi file = 1 giao dịch trong database dự án; cập nhật sổ thao tác = 1 giao dịch
trong database hệ thống. Hệ thống tắt giữa 2 bước → chạy lại an toàn, không tạo ra dữ liệu
sai. Ghi lại cùng nội dung → hệ thống nhận ra và bỏ qua (không làm nhiễu lịch sử).

### 7.7. Kết quả lệnh dài gửi dần (kế thừa bản gốc, đổi cơ chế)
Lệnh chạy lâu (vài phút) → kết quả gửi về agent **theo từng phần trong lúc chạy** (dùng cơ
chế thông báo của MCP), không chờ hết mới trả — lệnh 10 phút không làm nghẽn bộ nhớ hệ thống.

### 7.8. Quy tắc bỏ qua thư viện phụ thuộc — 3 tầng (C2)

| Tầng | Phạm vi | Hành vi |
| :--- | :--- | :--- |
| 1. Đường tự động | nạp file từ máy chủ, nhận về từ sandbox, quét Git | **Chặn cứng**: `node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `.pytest_cache/`, `dist/`, `build/`, `.cache/`, `.git/` + `/scratch`, `/tmp` — không bao giờ vào kho lưu |
| 2. Agent cố ý ghi vào thư mục bị bỏ qua | qua tool | **Chặn mặc định** + cho phép nếu đánh dấu "cho phép đè" rõ ràng |
| 3. `/scratch`, `/tmp` | mọi đường | Chặn tuyệt đối (chỉ nằm trong RAM của sandbox) |

⚠️ File ghi kiểu "cho phép đè" bị **"đóng băng"**: sửa đổi từ phía sandbox sẽ KHÔNG BAO GIỜ
được nhận về (ví dụ: cài lại thư viện đè lên file vừa chỉnh). Câu trả lời của tool bắt buộc
kèm cảnh báo này.

---

## 8. Vòng đời & tự chữa lỗi (kế thừa trọn bộ từ bản gốc)

| Cơ chế | Tần suất | Hành vi |
| :--- | :--- | :--- |
| **Dọn dẹp theo thời hạn** | mỗi 30 giây | Sandbox hết hạn bị dọn sạch; sandbox đang tạm dừng không bao giờ bị dọn; thông tin thời hạn lỗi → coi như chưa hết hạn (ưu tiên an toàn) |
| **Quét dọn sandbox mồ côi** | mỗi 5 phút | Sandbox thật đang sống nhưng hệ thống không còn ghi nhận → dọn; sandbox đang trong lúc tạo không bị dọn nhầm (phải đủ tuổi mới dọn); có công tắc tắt |
| **Phục hồi khi khởi động lại** | khi boot | Đọc sổ thao tác → hỏi thăm từng sandbox còn sống không → sống thì nhận nuôi tiếp; chết thì dọn sạch. KHÔNG cần file chụp trạng thái như bản gốc — database là nguồn thật |
| **Ghi sổ thao tác** | mọi thao tác | Mỗi thao tác một dòng sổ với mã duy nhất; thao tác treo quá hạn bị đánh dấu thất bại và làm lại an toàn |
| **Dọn bộ nhớ ngoài** | khi xóa sandbox | Volume Docker phải xóa tường minh — nó không tự biến mất theo sandbox |
| **Cache dùng chung theo dự án** | tùy chọn | Cache npm/pip dùng chung theo dự án — sau khi phục hồi không phải tải lại từ đầu |
| **Kết nối tới trình thực thi** | mỗi sandbox 1 kết nối | Mất kết nối → nối lại đúng một lần; xóa sandbox → đóng kết nối |

---

## 9. An toàn & quản trị

1. **Chặn lệnh nguy hiểm 2 lớp (C7):** lớp 1 chặn lệnh phá hoại rõ ràng (xóa toàn bộ đĩa,
   tải script lạ chạy ngay…); lớp 2 chặn lệnh shell tự ý ghi/xóa file — phá nguyên tắc "mọi
   thay đổi đi qua kho lưu". Mỗi lớp 2 chế độ: chặn hẳn, hoặc chỉ cảnh báo + ghi log (PoC
   dùng cảnh báo). **Lớp 2 quan trọng hơn cả bản gốc:** giờ đây xóa file trong sandbox sẽ
   dẫn tới xóa thật ở kho lưu.
2. **Kiểm tra đường dẫn MỘT chỗ duy nhất**, áp cho mọi điểm vào (ghi file, nhận về từ
   sandbox, quét Git, nạp file từ máy chủ) — chống truy cập ra ngoài thư mục dự án kiểu
   `../../etc/passwd`. Bản gốc rải kiểm tra nhiều nơi; bản clone gói một chỗ.
3. **Xác thực:** mặc định bỏ qua (nội bộ); khóa API bật khi cần cho CI.
4. **Hạn mức dung lượng** mỗi dự án + kiểm tra ở mọi điểm nạp file (mục 6.4).
5. **Ghi vết ba lớp:** sổ thao tác trong database + cảnh báo ngay trong câu trả lời của tool
   + log của bộ chặn lệnh.

---

## 10. Bảng quyết định kiến trúc đã chốt (đối chiếu kiến trúc gốc sandbox-kit)

| # | Quyết định | Lý do chính | Đánh đổi đã chấp nhận |
| :--- | :--- | :--- | :--- |
| **C1** | Bỏ lưu trữ đám mây: file ≤32MB trong database, file lớn thành file rời trên đĩa, file >3MB đi đường upload theo phần riêng | Đúng định hướng bản gốc ("không phụ thuộc dịch vụ ngoài"); loại bỏ cả một khối thành phần phức tạp; file quá lớn nằm trong database làm mọi thao tác chậm lại | Phải tự xây đường upload theo phần (đánh số, tải tiếp, kiểm tra, dọn rác); dataset rất lớn bị từ chối rõ ràng theo hạn mức |
| **C2** | Bỏ qua thư viện phụ thuộc 3 tầng (mục 7.8) | Thỏa chỉ thị "kho file chỉ chứa file nguồn" trên mọi đường tự động; vẫn cho chỉnh file đặc biệt khi đánh dấu rõ | File ghi kiểu "cho phép đè" bị đóng băng phía nhận về — cảnh báo bắt buộc |
| **C3** | Giữ trình thực thi riêng giao tiếp gRPC | Docker/K8s thuần không có trình thực thi sẵn; cần kênh giao tiếp mạnh, định dạng chặt | Phải xây và đóng gói 1 chương trình vào image sandbox |
| **C4** | Đồng bộ tách thành module riêng trong bộ điều phối | Yêu cầu P1#6 — bản gốc dán logic đồng bộ rải rác khắp nơi | — |
| **C5** | Lịch sử file lưu cho cả ghi lẫn sửa; giới hạn 20 bản/file; file >1MB không lưu bản đầy đủ | Lịch sử đầy đủ để đối chiếu; chi phí nhỏ | Định vị là lịch sử/đối chiếu — không quảng cáo là "hoàn tác" (bản gốc cũng không có nút hoàn tác) |
| **C6** | Bổ sung bảng `git_meta` (bản gốc có — thiết kế cũ của clone bị bỏ sót) | Thiếu là lỗi: Git cần nhớ nhánh, commit hiện tại, địa chỉ remote | — |
| **C7** | Bổ sung bộ chặn lệnh 2 lớp + chặn xóa hàng loạt khi nhận về | Khi có "nhận về", lệnh xóa trong sandbox trở nên nguy hiểm hơn cả bản gốc — xóa thật ở kho lưu | Có thể gây vướng cho agent — PoC dùng chế độ cảnh báo |
| **C8** | Giữ database hệ thống riêng (không dùng file JSON như bản gốc); kế thừa trọn bộ cơ chế tự chữa lỗi của bản gốc | Sổ thao tác cần truy vấn được; database thay thế trực tiếp tầng file JSON | — |
| **B6** | Giữ 3 hạ tầng: Docker (chính), Kubernetes (mở rộng), giả lập (test) | Phạm vi đề bài; bộ giả lập là điều kiện để test không cần Docker | — |

**Cơ chế kế thừa trọn vẹn từ bản gốc:** dọn dẹp theo thời hạn · quét mồ côi an toàn theo tuổi ·
phục hồi khi khởi động lại · tạm dừng không bị dọn · đồng bộ trượt tự sửa · kết nối lại đúng
một lần · kết quả lệnh gửi dần (đổi sang cơ chế thông báo của MCP) · cache dùng chung · dọn
volume tường minh.

---

## 11. Lộ trình PoC 5 tuần

Chi tiết: `poc-plan.md`. Tóm tắt: **tuần 1** nền kho file + MCP + bộ giả lập · **tuần 2**
Docker + trình thực thi + chạy lệnh · **tuần 3** đồng bộ hai chiều + xung đột · **tuần 4** tự
chữa lỗi + an toàn · **tuần 5** tích hợp + demo (+ mở rộng tùy sức).

---

## 12. Trạng thái tài liệu

| Tài liệu | Trạng thái |
| :--- | :--- |
| `system-design.md` (doc này) | **CANONICAL** — nguồn sự thật thiết kế (bản giản lược thuật ngữ) |
| `mcp-integration.md` | Bản nền chi tiết — mục Cloud Offload đã bị thay thế; còn lại vẫn tham chiếu được |
| `design/01-workspace-sync.md` | Vẫn hợp lệ (giao thức đã review 3 vòng); điểm hiệu chỉnh xem mục 10 |
| `design/assets/design-01-*.svg` | Sơ đồ hợp lệ; `design-01-datamodel.svg` chưa phản ánh git_meta + file rời (cập nhật khi build) |
| `poc-plan.md` | Kế hoạch PoC 5 tuần — điều hành theo 7 tiêu chí nghiệm thu A1–A7 |
