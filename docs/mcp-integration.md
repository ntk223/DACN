# MCP Integration Layer: Kiến trúc & Thiết kế (Sandbox Kit Clone)

> **Trạng thái:** BẢN NỀN (đã bị thay thế một phần) — nguồn sự thật thiết kế hiện hành là
> **`system-design.md`** (canonical, 2026-11-05, áp bộ quyết định C1–C8 sau khi đối chiếu
> kiến trúc gốc `sandbox-kit`). Điểm thay đổi chính: **§6 Cloud Offload → blob sidecar đĩa
> cục bộ, bỏ S3/presigned** (C1); ignore rules 3 tầng (C2); bổ sung `git_meta` (C6) + command
> policy gate (C7). Các mục còn lại vẫn tham chiếu được.
>
> Tài liệu này định nghĩa lớp **MCP (Model Context Protocol)** cho Sandbox Kit Clone: một
> giao diện thống nhất duy nhất để AI Agent thao tác với **toàn bộ nền tảng** (vòng đời
> sandbox, thực thi lệnh, quản lý file, Git, workspace). File dung lượng lớn KHÔNG đi qua
> MCP body — đi đường HTTP chunked riêng và blob sidecar đĩa cục bộ (xem `system-design.md`
> §4, §6.4) — đây là **chi tiết nội bộ**, agent không cần biết.

---

## 1. Vị trí trong hệ thống

MCP layer là **mặt tiền duy nhất** dành cho agent. Toàn bộ hạ tầng phía sau (Sandbox Manager,
VFS, Cloud Storage, sandbox runtime) là "vô hình" — kế thừa nguyên tắc
**Transparent Abstraction** đã định hình trong `sandbox-kit/docs/vfs_architecture.md` (mục 7).

```text
┌──────────────────────┐    MCP (Streamable HTTP)    ┌─────────────────────────────┐
│   AI AGENT           │ ──────────────────────────> │   MCP GATEWAY (mới)          │
│  Claude Code /       │   tools: sandbox_*,         │   facade mỏng,         │
│  Cursor / Custom     │   command_*, file_*,        │   KHÔNG chứa business logic  │
│                      │   git_*, workspace_*        └──────────┬──────────────────┘
└──────────────────────┘                                        │ REST nội bộ
                                          ┌─────────────────────┼─────────────────────┐
                                          ▼                     ▼                     ▼
                              ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
                              │ SANDBOX MANAGER  │   │  VFS SERVICE     │   │  CLOUD STORAGE   │
                              │  lifecycle +     │   │  file + git +    │   │  presigned URL,  │
                              │  command exec    │   │  metadata        │   │  multipart       │
                              │  + Workspace Sync│   │                  │   │                  │
                              └────────┬─────────┘   └────────┬─────────┘   └──────────────────┘
                                       │                       │
                                       │   SandboxProvider      │ files: BLOB (nhỏ) /
                                       ▼   interface           │ pointer {cloud_ref} (lớn)
                              ┌────────────────────────────────┴───┐
                              │   SANDBOX RUNTIME (pluggable)      │
                              │   docker │ k8s │ fake (test) │
                              │   → gRPC exec agent (in-container / sidecar) │
                              └────────────────────────────────────┘
```

**Vì sao MCP Gateway là service riêng, không nhét vào Sandbox Manager?**

| Lựa chọn | Ưu | Nhược | Quyết định |
| :--- | :--- | :--- | :--- |
| **Service riêng** gọi Sandbox Manager/VFS qua REST | Giao thức MCP thay đổi nhanh (2025-03-26 → 2026-07-28) tách khỏi REST ổn định của Sandbox Manager; scale độc lập; auth agent-facing tách biệt | Thêm 1 hop nội bộ (không đáng kể, cùng mạng) | ✅ **Chọn** |
| Mount ASGI app MCP vào Sandbox Manager (`mcp.http_app()`) | Ít process, reuse auth middleware | Gắn chặt version MCP SDK vào Sandbox Manager; restart Sandbox Manager làm rớt session MCP | Phương án dự phòng |

---

## 2. Nguyên tắc thiết kế (Design Principles)

1. **MCP Gateway là facade mỏng.** Mỗi tool = 1 hàm wrapper gọi REST Sandbox Manager/VFS. Không business
   logic, không state ngoài registry session. Toàn bộ logic thuộc về Sandbox Manager/VFS/Provider.
2. **Agent chỉ nhìn thấy một bộ tool thống nhất.** Việc file lớn đi cloud hay VFS, container
   chạy runtime nào, sync delta kiểu gì — hoàn toàn trong suốt.
3. **Runtime-agnostic.** `sandbox_create` (và mọi tool lifecycle) đi qua **`SandboxProvider`
   interface** — không bao giờ gọi trực tiếp SDK của một runtime cụ thể (mục 3).
4. **File bytes không bao giờ chạy qua MCP message.** MCP JSON body mặc định giới hạn ~4 MiB
   và base64 tốn +33% overhead. File lớn đi đường presigned URL thẳng đến cloud (mục 6).
5. **Nguồn chân lý không đổi.** VFS vẫn là Single Source of Truth cho cây file + metadata;
   Git remote vẫn là nơi lưu lịch sử. Cloud chỉ là **tier lưu trữ lạnh/lớn** của VFS.

---

## 3. Sandbox & Runtime — đặc tả sandbox và abstraction

Mục này tách làm hai phần: **3.1** trả lời câu hỏi "sandbox là gì" — bên trong có gì, sống
chết thế nào (nền cho mọi tool call); **3.2 → 3.9** là abstraction phía dưới (provider
interface, capability, isolation, exec agent).

### 3.1. Sandbox là gì — đặc tả & vòng đời

**Định nghĩa.** Sandbox = **một môi trường thực thi cô lập, ngắn hạn (ephemeral)**, provision
từ image, bên trong chứa đúng hai thứ: **toolchain + user code** (từ image) và **exec agent**
(mục 3.9). Sandbox là *cattle, không phải pet* — bị thay thế bất cứ lúc nào mà không mất dữ
liệu quan trọng (dữ liệu bền nằm ở VFS, mục 4.3).

**Bên trong sandbox có gì (anatomy):**

```text
┌─────────── SANDBOX = container (Docker) hoặc pod (K8s) ───────────────┐
│                                                                       │
│  FILESYSTEM                                                           │
│  ├─ /workspace      ← volume/PVC mount từ prepare_workspace           │
│  │                     (BỀN — SSOT là VFS, sandbox chỉ là "view")     │
│  ├─ /tmp, /scratch  ← ephemeral — mất khi sandbox chết, không offload │
│  └─ image layers    ← golden image (đọc-only): bash, git,             │
│                       python/node, exec agent                         │
│                                                                       │
│  PROCESSES                                                            │
│  ├─ exec agent      ← PID 1 (Docker) / sidecar (K8s) — gRPC server    │
│  └─ user process    ← do command_run sinh ra, sống ngắn hạn           │
│                                                                       │
│  NGUỒN LỰC (giới hạn cứng)                                            │
│  └─ cpu · memory (cgroup / requests+limits) · ttl (auto-expire)       │
│                                                                       │
│  NETWORK                                                              │
│  ├─ egress         → cloud storage (presigned GET prefetch)           │
│  └─ ingress        → chỉ khi endpoint_expose=true (capability)        │
└───────────────────────────────────────────────────────────────────────┘
```

**Tham số tạo sandbox (`SandboxSpec`) — đủ field để dựng được mà không cần config ngoài:**

| Field | Truyền qua `sandbox_create`? | Mặc định | Ghi chú |
| :--- | :--- | :--- | :--- |
| `image` | ✅ | golden image theo profile | cài sẵn toolchain phổ biến + exec agent |
| `cpu`, `memory` | ✅ | theo profile | giới hạn cứng: cgroup (Docker) · requests+limits (K8s) |
| `ttl_seconds` | ✅ | theo profile | hết TTL → auto terminate |
| `entrypoint`, `env` | ✅ | — | override khi cần |
| `provider` | ✅ | theo env | `docker` \| `k8s` (mục 3.5) |
| `isolation` | ✅ | theo profile | `runc` \| `runsc` \| `kata` (mục 3.8) |

**Vòng đời (state machine):**

```text
create_sandbox()
      │
      ▼
PROVISIONING ── healthcheck gRPC fail ──► lỗi agent_unavailable (fail-fast)
      │ OK
      ▼
   RUNNING ◄────resume───── PAUSED (capability pause_resume)
      │
      ├─ sandbox_kill() ─────────► TERMINATED (dọn workspace nếu yêu cầu)
      ├─ hết TTL ────────────────► EXPIRED → TERMINATED (auto dọn)
      └─ chết bất ngờ (OOM/crash)─► Manager phát hiện qua healthcheck
                                   → provision lại + resync (mục 8) — giữ nguyên session_id
```

**Cái gì bền, cái gì mất (persistence model):**

| Dữ liệu | Bền? | Nơi bền thật |
| :--- | :--- | :--- |
| `/workspace/*` | ✅ | VFS (source of truth) — sandbox chết, file vẫn ở VFS; sandbox mới resync là có lại |
| Revisions, lịch sử git | ✅ | VFS |
| `/tmp`, `/scratch`, process state, env runtime | ❌ | Ephemeral theo thiết kế |
| `session_id` ↔ sandbox mapping, sync state | ✅ đến khi kill/expired | System SQLite do Manager sở hữu — ghi chú ngay dưới |

**Persistence = SQLite làm công nghệ lưu trữ duy nhất, TÁCH FILE THEO WORKSPACE (chốt).** VFS
giữ mô hình bản gốc: **mỗi dự án (workspace) một file SQLite riêng**
(`data/workspaces/{workspace_id}.sqlite`, WAL) — chứa đúng dữ liệu dự án đó: file source,
metadata, revisions, tombstone, bộ đếm `workspace_revision`. Ngoài ra MỘT system DB
(`data/system.sqlite`, do Sandbox Manager sở hữu) chứa registry toàn hệ thống: workspace list,
session, sandbox mapping, sync state, operation tracking (mục 8.1). Quy tắc sắt: **một file
SQLite = một process giữ quyền ghi duy nhất** — workspace DB chỉ VFS ghi, system DB chỉ Manager
ghi; hết SQLITE_BUSY storm. VFS **chỉ lưu file source** — ignore rules cứng:
`node_modules/`, `.venv/`, `__pycache__/`, `dist/`, `.git/`… không bao giờ vào VFS (kế thừa
`shouldIgnoreVfsPath` bản gốc, chi tiết design 01 mục 8). Isolation tenant = **vật lý** (file
riên — xóa workspace = xóa file, giải phóng 100% dung lượng như bản gốc). Đánh đổi: không có
transaction xuyên hai file — an toàn vì mọi thao tác sync idempotent theo revision (design 01
mục 9). Chi tiết schema: `docs/design/01-workspace-sync.md`.

Nguyên tắc: mọi thứ cần sống sót **phải nằm ở VFS trước khi sandbox chết** — đây là lý do
"resync manifest" đủ để khôi phục sandbox mới thay vì copy dữ liệu thô.

**Quan hệ workspace ↔ session ↔ sandbox.** Bền bỉ giảm dần: **workspace** (bền vĩnh viễn —
1 workspace : N session theo vòng đời, contract ở mục 12.1) → **session** (sống đến kill/expired)
→ **sandbox** (ephemeral — 1 `session_id` ↔ 1 sandbox sống tại một thời điểm; recovery thay
sandbox mới nhưng giữ nguyên `session_id`). Agent không bao giờ cần biết `sandbox_id` lẫn
`workspace_id` bên dưới — mọi tool call chỉ gửi `session_id`. Chi tiết image layering / egress
policy để giai đoạn thiết kế chi tiết.

### 3.2. Vấn đề & Động cơ

Bản gốc `sandbox-kit` đã có `SandboxProvider` ABC trong thành phần **Broker**
(`sandbox-kit/broker/services/runtime/base.py`) với `get_provider()` chọn provider qua env
`SANDBOX_PROVIDER`. Clone này **đổi tên thành phần này thành Sandbox Manager** (tên gọi chính
thức trong toàn bộ tài liệu) và **loại bỏ hoàn toàn OpenSandbox** (không còn là runtime mục
tiêu), áp dụng mô hình **hybrid**:

- `docker` — dev / laptop / CI không cần cluster, khởi động tức thì.
- `k8s` — production cluster, scale ngang, resource governance chuẩn.
- `fake` — provider in-process cho test/E2E, không cần container.

Ràng buộc bất biến: **không một dòng code phía trên interface được import SDK runtime cụ thể**
(`docker` SDK, `kubernetes` client chỉ được xuất hiện bên trong module provider tương ứng).

Lợi ích cụ thể:

- **Không lock-in:** Runtime hôm nay là Docker/K8s; ngày mai cần Firecracker MicroVM hay
  sandbox self-hosted — chỉ viết 1 provider mới, không sửa một dòng tool nào.
- **Triển khai hybrid:** provider "remote" cho production (cluster), provider "docker" cho
  dev laptop không có cluster. Cùng một MCP tool set.
- **Kiểm thử:** provider giả (`FakeProvider`) chạy in-process cho test/E2E không cần container.

### 3.3. Contract của Provider (kế thừa & mở rộng từ base.py)

**Bắt buộc (abstract):**

| Method | Ý nghĩa |
| :--- | :--- |
| `name` (property) | Định danh provider, khớp giá trị env `SANDBOX_PROVIDER` |
| `create_sandbox(session_id, spec) -> SandboxHandle` | Provision sandbox từ `SandboxSpec` (image, ttl, cpu, memory, entrypoint, extensions, **isolation**), trả về handle |
| `start_sandbox(handle) -> bool` | Đánh thức sandbox paused/stopped |
| `terminate_sandbox(sandbox_id) -> bool` | Hủy và dọn dẹp |
| `prepare_workspace(session_id, host_project_path) -> str` | Seed project vào backend storage, trả tên volume/claim mount tại `/workspace` — nội dung có sẵn trong sandbox ngay lúc start, **KHÔNG đi qua sync** |
| `get_dial_target(sandbox_id) -> str` | Trả dial address của **gRPC exec agent** bên trong sandbox (host:port khi Docker port-mapping; pod IP:port khi K8s; vsock URI khi microVM). Sandbox Manager dùng để mở kênh gRPC — provider **chỉ lo network reachability**, không tự implement exec/sync_files (mục 3.9) |

**Tùy chọn (default raise `NotImplementedError` → tính năng degrade có kiểm soát):**

| Method | Ghi chú |
| :--- | :--- |
| `sync_files(sandbox_id, changed[], deleted[]) -> dict` | **Fallback** khi exec agent unreachable (mục 3.9): Docker `put_archive` (tar stream), K8s `tar -x`. Đường chính là RPC `SyncFiles` của agent — provider không cần implement nếu image luôn đóng gói agent |
| `pause_sandbox` / `resume_sandbox` | Runtime không hỗ trợ → capability tắt |
| `renew_sandbox(sandbox_id, ttl) -> {expiresAt}` | Gia hạn TTL |
| `get_sandbox_metrics` | CPU/RAM/network metrics |
| `get_sandbox_diagnostics` | logs/events |
| `get_sandbox_endpoint(sandbox_id, port) -> {url}` | Ingress/expose port |

**Bổ sung mới cho clone:**

| Method | Lý do |
| :--- | :--- |
| `capabilities -> ProviderCapabilities` | Khai báo năng lực runtime (mục 3.4) — thay vì để agent gọi rồi gặp `NotImplementedError` |
| `healthcheck(sandbox_id) -> bool` | Kiểm tra sandbox sống, dùng cho `sandbox_healthcheck` tool |
| `list_sandboxes(filter) -> list` | Liệt kê sandbox thuộc quản lý của provider này |

### 3.4. Capability Flags — degrade có kiểm soát

```python
@dataclass(frozen=True)
class ProviderCapabilities:
    pause_resume: bool = False      # pause/resume sandbox
    metrics: bool = False           # get_sandbox_metrics
    diagnostics: bool = False       # logs/events
    snapshots: bool = False         # snapshot/restore (nếu runtime hỗ trợ)
    endpoint_expose: bool = False   # ingress public URL
    isolation_tiers: frozenset[str] = frozenset({"runc"})  # OCI runtime: runc | runsc | kata | ...
    extensions: frozenset[str] = frozenset()  # extension flags do provider tự định nghĩa
```

- MCP Gateway đọc `capabilities` lúc khởi động và **chỉ đăng ký tool tương ứng** (agent không
  thấy tool mà runtime không hỗ trợ — tránh gọi hụt).
- Gateway chỉ chấp nhận giá trị `isolation` nằm trong `isolation_tiers` của provider đang phục
  vụ; giá trị khác → lỗi chuẩn hóa `capability_unavailable` (mục 3.8).
- Sandbox Manager vẫn có thể chọn degrade mềm: trả lỗi chuẩn hóa
  `{"error": "capability_unavailable", "capability": "pause_resume", "provider": "docker"}`.

### 3.5. Provider Factory & Registry

```python
_KNOWN_PROVIDERS = {"docker", "k8s", "fake"}  # registry — OpenSandbox đã loại bỏ

def get_provider(name: str | None = None) -> SandboxProvider:
    """Độ ưu tiên: `name` (từ `spec.provider` của tool call) > env `SANDBOX_PROVIDER`
    (default "docker" — dev-first; production set "k8s"). Unknown value → fail-fast
    lúc startup (khác base.py gốc: warning rồi fallback — fail sớm để tránh chạy
    nhầm runtime trong production)."""
```

- Hybrid là chế độ mặc định: dev chạy `docker`, production chạy `k8s` (env). Nâng cấp tự
  nhiên: registry theo `spec.provider` cho phép **chọn runtime từng lần gọi** `sandbox_create`
  (vd. job ngắn → docker node pool, job dài/ngoài giờ → k8s) — thiết kế tool MCP không đổi.
- Mỗi provider nằm trong module riêng:
  `broker/services/runtime/docker_provider.py`, `k8s_provider.py`, `fake_provider.py`
  — import lazily để tránh circular import (giữ nguyên quy ước gốc).

### 3.6. Conformance Test — điều kiện "làm provider mới"

Mọi provider phải pass một bộ test hợp đồng chung (`tests/runtime/conformance/`), chạy trên
mỗi implementation: vòng đời create→exec→terminate, delta sync đúng sha256 (qua RPC `SyncFiles`
hoặc fallback, mục 3.9), path traversal bị chặn, hành vi khi sandbox chết giữa chừng, renew TTL,
capability flags khớp thực tế. **Provider không pass conformance không được đăng ký vào `_KNOWN_PROVIDERS`.**

---

### 3.7. Ma trận triển khai theo Provider

| Khía cạnh | Docker (dev) | Kubernetes (prod) |
| :--- | :--- | :--- |
| Provision | `docker run` + limits (`--cpus`, `--memory`) | Pod + requests/limits theo `spec` |
| Isolation tier | Flag `--runtime` của engine (runc / runsc / kata) | `RuntimeClass` (`runtimeClassName` trong pod spec) |
| Exec lệnh + Sync file | **gRPC exec agent** chạy trong sandbox (mục 3.9) — provider chỉ lo network reachability, không tự implement exec/sync_files |
| `/workspace` | Named volume / bind mount | PVC (StorageClass theo workspace) |
| Endpoint expose | Publish port trên host | Service + Ingress |
| Metrics | `docker stats` API | metrics-server / kubelet stats |
| Pause / Resume | `docker pause` / `unpause` (capability = **true**) | Không native (capability = **false**) |
| TTL hết hạn | Timer trong broker + `docker rm -f` | Owner reference + TTL controller / cleanup job |
| Healthcheck | `docker inspect` (state, oom) | Pod phase + readiness probe |
| Diagnostics | `docker logs` | `kubectl logs` + Events |

Cả hai provider phải pass **cùng một bộ conformance test** (mục 3.6) — điều kiện đảm bảo
hành vi MCP tool giống hệt nhau bất kể runtime phía dưới.

### 3.8. Isolation Tiers — cấp độ cô lập của runtime

Ngoài việc chọn provider (docker/k8s — *nơi chạy*), mỗi sandbox còn có **isolation tier** —
*cách cô lập*, là trục thứ hai trực giao với provider. Tier là định danh OCI runtime;
provider tự map sang cơ chế riêng:

| Tier | Cơ chế | Sức cô lập | Overhead | Phù hợp |
| :--- | :--- | :--- | :--- | :--- |
| `runc` | Namespaces + cgroups, chia sẻ host kernel | Cơ bản | Baseline (nhanh nhất) | CI tin cậy, build nội bộ |
| `runsc` (gVisor) | User-space kernel (Sentry) chặn syscall | Cao — chặn kernel escape | ~10–20% syscall; một số syscall thiếu | Chạy code không tin cậy / do user gửi |
| `kata` | MicroVM (Firecracker/QEMU) — mỗi sandbox một VM | Cao nhất — hardware virtualization | RAM + boot cao hơn nhẹ | Multi-tenant khắt khe, workload nhạy cảm |

Quy tắc thiết kế:

1. `isolation` là **tham số của `SandboxSpec`** (mặc định theo profile, vd `runc`); agent có thể
   chỉ định từng lần gọi `sandbox_create` — chỉ những tier có trong `capabilities.isolation_tiers`
   mới được chấp nhận.
2. Provider map tier sang cơ chế riêng: Docker → flag `--runtime`; K8s → `RuntimeClass`.
   Conformance test phải bao gồm **ít nhất tier mặc định** của provider.
3. Danh sách tier **mở**: thêm runtime mới (Firecracker standalone, youki, ...) = thêm định danh
   + mapping trong provider, không đổi contract MCP.
4. Gợi ý policy mặc định: code do agent sinh ra phục vụ end-user → tier tối thiểu `runsc`;
   workload CI nội bộ tin cậy → `runc` đủ. Policy đặt ở profile, không hard-code vào tool.

### 3.9. gRPC Exec Agent — kênh điều khiển chuẩn hóa vào sandbox

**Vấn đề.** Nếu mỗi provider tự implement exec + sync_files (Docker Exec API + `put_archive`,
K8s `pod/exec` + `tar -x`, ...) thì logic "thực thi lệnh trong sandbox" bị nhân đôi ở mỗi
provider, conformance test phải cover từng biến thể, và thêm runtime mới = viết lại từ đầu.

**Giải pháp.** Mỗi sandbox có **một exec agent** chạy bên trong, expose gRPC server với 4 RPC
tối thiểu: `Exec` (stream stdout/stderr/exit), `SyncFiles` (client-streaming upload + server-streaming
download), `Healthcheck`, `GetMetrics`. Sandbox Manager chỉ cần **một gRPC client duy nhất**;
provider chỉ cần (a) start container có agent, (b) trả `get_dial_target(sandbox_id)` để Manager
biết nối vào đâu.

**Vị trí của agent trong sandbox:**

| Runtime | Cách đóng gói | Lý do |
| :--- | :--- | :--- |
| Docker (dev) | **In-container** — agent là entrypoint đầu tiên của image, chạy nền song song với user code | Đơn giản nhất; image golden đã có sẵn agent binary |
| Kubernetes (prod) | **Sidecar container** trong cùng pod, share `/workspace` volume với main container | Tách vòng đời agent khỏi user code; có thể restart agent độc lập; mount secret mTLS riêng |
| `fake` (test) | Không cần agent — provider giả trả kết quả in-process | Conformance test chạy không cần container |

**Trust model theo isolation tier** (xem mục 3.8):

| Tier | Rủi ro agent bị user code tấn công | Biện pháp |
| :--- | :--- | :--- |
| `runc` | **Cao** — chung kernel, user code có thể kill/giả mạo agent | Agent chạy với PID 1 + namespace riêng; mTLS bắt buộc; chỉ chấp nhận workload tin cậy |
| `runsc` (gVisor) | Thấp — syscall bị Sentry chặn, user code khó chạm kernel | mTLS tiêu chuẩn; agent chạy ngoài Sentry sandbox của user code |
| `kata` (microVM) | Rất thấp — VM boundary | mTLS tiêu chuẩn; có thể bỏ mTLS nếu network namespace cô lập hoàn toàn |

**Image strategy.** Agent binary được build 1 lần, pin version, đóng vào **golden image** chung
cho mọi provider. Image nào thiếu agent → sandbox "sống nhưng không giao tiếp được" — fail-fast
lúc `create_sandbox` (healthcheck gRPC timeout → trả lỗi `agent_unavailable`).

**Bảo mật kênh.** mTLS với CA nội bộ của platform; mỗi sandbox một cert, rotation theo TTL
của sandbox. Cert được mount vào sandbox lúc provision (Docker: env file; K8s: projected
volume). Provider không cần biết chi tiết — chỉ cần dial target.

**Tác động lên provider contract.** Provider **mỏng đi đáng kể**: `sync_files` chuyển thành
**tùy chọn** — chỉ là fallback khi agent unreachable (vd image tùy chỉnh không đóng gói agent),
KHÔNG phải vì "multi-GB nhanh hơn" (cả hai đường đều đưa bytes qua Manager). Đường chính là
RPC `SyncFiles`. Bổ sung `get_dial_target` vào danh sách bắt buộc (xem mục 3.3). Toàn bộ logic
exec/sync tập trung ở Sandbox Manager ↔ agent.

**Phạm vi kiến trúc (chưa đi sâu).** Tài liệu này dừng ở mức: agent là gì, ở đâu, trust model,
image strategy, mTLS plan. Chi tiết protobuf schema, retry policy, streaming backpressure,
versioning sẽ được tách thành tài liệu thiết kế riêng khi bắt đầu implement.

---

## 4. MCP Tool Catalog

Bộ tool bám theo **Filesystem MCP reference server** (quy ước đặt tên tool file) và quy ước
tool sandbox/command phổ biến trong các MCP server quản lý sandbox. Mapping đích đến luôn
qua service (Sandbox Manager/VFS), không bao giờ chạm runtime trực tiếp.

### 4.1. Sandbox Lifecycle → Sandbox Manager → SandboxProvider

| Tool | Tham số chính | Ghi chú |
| :--- | :--- | :--- |
| `sandbox_create` | `image`, `cpu`, `memory`, `ttl_seconds?`, `entrypoint?`, `env?`, `provider?: "docker" \| "k8s"`, `isolation?: "runc" \| "runsc" \| "kata"` | Hybrid: provider mặc định theo env, **chọn được runtime từng lần gọi**; isolation kiểm tra theo `capabilities.isolation_tiers`; trả `session_id`, `sandbox_id`, `expires_at`, `provider`, `isolation` |
| `sandbox_connect` | `session_id` | Gắn lại session đang sống sau restart |
| `sandbox_kill` | `session_id` | Terminate + dọn workspace nếu có yêu cầu |
| `sandbox_list` | `filter?` | Qua `provider.list_sandboxes` |
| `sandbox_renew` | `session_id`, `ttl_seconds` | Degrade nếu runtime không hỗ trợ |
| `sandbox_healthcheck` | `session_id` | |
| `sandbox_get_info` | `session_id` | Metadata + state |
| `sandbox_get_endpoint` | `session_id`, `port` | Chỉ hiện khi `endpoint_expose=true` |

### 4.2. Command Execution → Sandbox Manager

| Tool | Tham số chính | Ghi chú |
| :--- | :--- | :--- |
| `command_run` | `session_id`, `command`, `cwd?`, `env?`, `timeout?` | Sandbox Manager auto sync delta trước khi chạy — theo thứ tự ưu tiên bên dưới |
| `command_interrupt` | `session_id`, `request_id` | Hủy lệnh đang chạy |

**Thứ tự ưu tiên vận chuyển delta vào sandbox (cố định — một chỗ duy nhất, mọi provider như
nhau).** Delta được tính và điều phối bởi thành phần **Workspace Sync** — module điều phối đồng
bộ VFS ↔ sandbox, tách riêng khỏi lifecycle/exec trong Sandbox Manager (đặc tả chi tiết:
`docs/design/01-workspace-sync.md`):

| Ưu tiên | Điều kiện | Đường đi |
| :--- | :--- | :--- |
| **1** | exec agent healthy (healthcheck gRPC OK) | Manager đọc bytes từ VFS → RPC `SyncFiles` qua gRPC tới agent (mục 3.9) |
| **2** | agent unreachable **và** provider có `sync_files` | Provider native — Docker `put_archive` / K8s `tar -x` |
| **3** | không đường nào khả dụng | Lỗi chuẩn hóa `sync_unavailable` |

File offloaded cloud **không thuộc delta push** — được prefetch bằng presigned GET trong
pre-step của chính lệnh (xem mục 5.3).

### 4.3. File Management → VFS (+ Cloud Offload trong suốt)

| Tool | Tham số chính | Ghi chú |
| :--- | :--- | :--- |
| `file_read` | `session_id`, `path`, `head?`/`tail?`, `offset?`, `encoding?` | Text mặc định; binary trả base64 kèm MIME; **range đọc** cho file lớn |
| `file_write` | `session_id`, `path`, `content` **hoặc** `upload_url_flow` | Xem mục 6.2: content nhỏ ghi trực tiếp; file lớn trả presigned URL |
| `file_edit` | `session_id`, `path`, `edits[]`, `dry_run?` | Fuzzy diff patching của VFS; trả unified diff + `first_changed_line` |
| `file_delete` | `session_id`, `path`, `recursive?` | Xóa cả pointer cloud nếu là file offloaded |
| `file_move` | `session_id`, `source`, `destination` | Rename/move metadata, không di chuyển bytes |
| `file_search` | `session_id`, `prefix`, `pattern?` | Glob qua VFS |
| `file_info` | `session_id`, `path` | size, sha256, mtime, `storage_class: "vfs" \| "cloud"` |
| `file_create_directories` / `file_delete_directories` | | |
| `file_revisions` | `session_id`, `path` | Lịch sử 20 patch gần nhất để undo (kế thừa VFS) |

### 4.4. Git → VFS Git Engine (isomorphic-git)

| Tool | Ghi chú |
| :--- | :--- |
| `git_clone` | Shallow clone vào VFS (worktree mirror v2) |
| `git_status` / `git_branch` / `git_commit` / `git_push` | Giữ contract REST `/api/vfs/git/*` |

### 4.5. Workspace

| Tool | Ghi chú |
| :--- | :--- |
| `workspace_manifest` | Danh sách `{path, size, sha256}` — quan sát/kiểm chứng; delta sync tính theo workspace revision (design 01) |
| `workspace_list` | Các workspace đang sống |

---

## 5. Luồng dữ liệu tiêu biểu

### 5.1. `sandbox_create` — qua Provider Interface

```text
Agent → MCP sandbox_create(image=..., cpu=..., provider?=...)
      → MCP Gateway gọi POST /api/v1/management/sessions (Sandbox Manager)
      → Sandbox Manager: get_provider(spec.provider?) → SandboxProvider.create_sandbox(spec)
          ↳ DockerProvider (dev):  docker run + cpu/mem limits + volume /workspace
          ↳ K8sProvider (prod):    Pod + PVC + exec sidecar + readiness probe
      → healthcheck tới RUNNING → trả {session_id, sandbox_id, expires_at, provider}
```

Agent nhận thêm trường `provider` trong response chỉ để **quan sát** — mọi tool call sau đó
chỉ cần `session_id`.

### 5.2. Ghi file lớn — offload trong suốt

```text
Agent → MCP file_write(session_id, path="dataset.csv", size=800MB)   [chỉ metadata]
      → VFS: 800MB > CLOUD_OFFLOAD_THRESHOLD → tạo object key server-side
      → trả {upload: {mode: "presigned_multipart", upload_id, part_urls[batch], ...}}
      → Agent PUT thẳng từng part lên Cloud (KHÔNG qua MCP Gateway)
      → MCP file_write_complete(session_id, path, etags[], sha256)
      → VFS verify sha256 → bảng files lưu POINTER {cloud_ref, sha256, size}
```

### 5.3. `command_run` — sync delta có file cloud

```text
Agent → MCP command_run(session_id, "python train.py")
      → Workspace Sync tính delta theo workspace revision (rev > mốc sync) → {changed[], deleted[]}
      → vận chuyển delta theo ưu tiên (mục 4.2):
          train.py (nhỏ, VFS)        → batch SyncFiles qua gRPC tới exec agent
          dataset.csv (800MB, cloud) → KHÔNG push — ghi vào pre-step prefetch
      → Manager gửi agent.Exec([pre-step, lệnh chính]):
          step 1: curl -o /workspace/dataset.csv "<presigned GET 10 phút>"
          step 2: python train.py
      → agent stream stdout/stderr → Sandbox Manager → Agent
      → exit code + duration trả về tool response
      → Workspace Sync pull-back: agent trả manifest /workspace → file mới/sửa được áp
        ngược về VFS (bump workspace revision, xử lý conflict) — dữ liệu sống sót sandbox chết
```

Bytes file cloud đi **thẳng cloud → sandbox** qua presigned GET — không chạm Manager (nguyên
tắc "Manager không là đường ống bytes", mục 6.5). Nếu agent unreachable và provider có
`sync_files` → fallback native, pre-step prefetch vẫn giữ nguyên (mục 4.2).

---

## 6. Cloud Offload cho File lớn

### 6.1. Chính sách ngưỡng (Threshold Policy)

| Kích thước | Nơi lưu | Cách đọc/ghi |
| :--- | :--- | :--- |
| `< CLOUD_OFFLOAD_THRESHOLD` (default **2 MB**, env cấu hình) | VFS SQLite (BLOB) | Như hiện tại — read <2ms |
| `≥ threshold` | Cloud Storage; VFS giữ pointer | Presigned URL flow |
| `≥ 100 MB` | Cloud + **multipart bắt buộc** | Part 8–16 MB, max 10.000 parts, part cuối ≥ 5 MB |
| `/scratch/*`, `/tmp/*` | Không bao giờ offload | Vẫn tmpfs ephemeral trong sandbox |

**Vì sao default 2 MB (không phải 10 MB) — đóng khoảng chết 3–10 MB.** Body MCP giới hạn
~4 MiB và base64 tốn +33% → nội dung inline tối đa ~3 MB. Nếu threshold 10 MB thì file 3–10 MB
rơi vào khoảng chết: quá lớn cho inline, quá nhỏ cho offload — không đi được đường nào. Ngưỡng
buộc phải **nhỏ hơn capacity inline** với margin → default 2 MB.

### 6.2. Luồng Upload (Presigned + Multipart)

1. `file_write` chỉ nhận **metadata** (path, size, content_type, sha256 client tính nếu có).
2. VFS sinh **object key phía server** — không bao giờ tin key từ client
   (`workspaces/{workspace_id}/files/{uuid}-{safe_name}`), gắn tenure isolation theo prefix.
3. Trả presigned URL: file <100MB → 1 URL PUT; lớn hơn → multipart, **presign theo batch
   50–100 part** (client xin tiếp khi cần — tránh sign 5.000 URL một lần).
4. Client upload thẳng cloud, thu thập `PartNumber + ETag`; part lỗi retry riêng part đó.
5. `file_write_complete`: server gọi `CompleteMultipartUpload`, **verify sha256 + size**,
   ghi pointer vào VFS, ghi revision patch như file thường.
6. URL hết hạn **10 phút**; IAM của service scope tối thiểu
   (`PutObject`, `AbortMultipartUpload`, `ListMultipartUploadParts`, `GetObject` trên prefix
   `workspaces/*`).

### 6.3. Schema VFS — bảng `files` mở rộng

Bảng `files` (và `file_revisions`) nằm trong **file SQLite của từng workspace**
(`data/workspaces/{id}.sqlite` — một dự án một file, mục 3.1); **chỉ chứa file source** theo
ignore rules — `node_modules/`, `.venv/`, `dist/`… không bao giờ vào đây.

```sql
ALTER TABLE files ADD COLUMN storage_class TEXT NOT NULL DEFAULT 'vfs';  -- 'vfs' | 'cloud'
ALTER TABLE files ADD COLUMN cloud_ref TEXT;        -- object key trong bucket (NULL nếu vfs)
ALTER TABLE files ADD COLUMN etag TEXT;             -- xác nhận multipart, đối chiếu khi verify
-- content BLOB: NULL khi storage_class = 'cloud' (pointer-only)
```

- `file_read` trên file cloud: trả presigned GET URL (ngắn hạn) hoặc stream proxy qua VFS
  tùy `CLOUD_READ_MODE` (`url` | `proxy`).
- Delta sync manifest vẫn là `{path, size, sha256}` — **không đổi cấu trúc**, broker chỉ cần
  biết file nào phải prefetch theo reference.
- Dọn dẹp: xóa workspace → xóa pointer + batch delete object cloud (bắt buộc implement cùng
  lúc với offload, không để mồ côi object); incomplete multipart bị lifecycle rule
  **abort sau 24h**.

### 6.4. Bảo mật

- Key sinh server-side, prefix theo workspace → không path traversal, không ghi đè chéo tenant.
- Presigned URL: scope 1 operation / 1 key (hoặc 1 part number), thời hạn ngắn.
- Verify sha256 bắt buộc trước khi pointer được coi là hợp lệ (`status: pending → verified`).
- Không passthrough token của agent xuống cloud — service dùng credential riêng.

### 6.5. Vì sao bytes không đi qua MCP Gateway

MCP Gateway **vẫn quản lý toàn bộ vòng đời file** — chỉ có **bytes** không chạy qua nó. Đây là
chủ đích, không phải bỏ sót. Quản lý bằng cách kiểm soát **3 điểm chạm**, không bằng cách ôm
bytes:

```text
① file_write(size=800MB)          ② PUT trực tiếp           ③ file_write_complete
   Agent ── qua MCP ──────────>      Agent ──> Cloud            Agent ── qua MCP ──>
   ┌─────────────────────┐          (không qua Gateway)       ┌─────────────────────┐
   │ Gateway kiểm soát:  │                                      │ Gateway kiểm soát:  │
   │ · authz + quota     │                                      │ · verify sha256     │
   │ · policy (size, type)│                                     │ · xác nhận pointer  │
   │ · sinh key server-side│                                    │ · ghi revision      │
   │ · presign URL (10') │                                      │ · audit log         │
   └─────────────────────┘                                      └─────────────────────┘
```

Agent không thể tự ý upload gì cả: không có URL từ ① thì không upload được; không qua ③ thì
pointer không bao giờ ở trạng thái `verified` — file "không tồn tại" với hệ thống. Quota, audit,
xác thực đều nằm ở ① và ③.

**Nếu bắt bytes đi qua MCP thì vỡ 4 điều:**

| # | Vấn đề | Chi tiết |
| :--- | :--- | :--- |
| 1 | **Giới hạn giao thức** | Tool call là JSON; body mặc định ~4 MiB. File 500MB phải base64 (+33% overhead) hoặc raise limit lên hàng trăm MB — đi ngược chuẩn MCP |
| 2 | **Gateway thành bottleneck băng thông** | Mọi byte đi 2 chặng (agent→gateway→cloud). Gateway phải buffer + encode/decode. 10 agent upload song song = giết process mỏng, stateless mà đang muốn scale ngang |
| 3 | **Mất multipart song song** | Presigned cho phép upload 8–16MB parts đồng thời thẳng S3, retry từng part. Qua proxy thì chuỗi hóa, tăng latency, retry tốn hơn |
| 4 | **Độ bền phiên** | Upload 2GB mất vài phút — gateway restart giữa chừng là mất transfer; upload trực tiếp không quan tâm gateway sống chết |

Đây là nguyên tắc chuẩn trong kiến trúc storage: **API server/gateway không bao giờ là đường ống
của file bytes** (AWS cũng khuyến nghị pattern này cho S3).

**Trường hợp ngoại lệ hợp lệ.** Môi trường agent không có egress tới cloud (mạng nội bộ chặn
S3/MinIO) → cần proxy mode. Design đã chừa sẵn: `CLOUD_READ_MODE=proxy` (mục 6.3) cho read; có
thể bổ sung tương tự cho write (tool `file_upload_proxy` stream qua Gateway) như một **capability
tùy chọn**, không phải đường mặc định.

---

## 7. Transport & Onboarding của MCP Gateway

| Hạng mục | Lựa chọn | Ghi chú |
| :--- | :--- | :--- |
| Transport | **Streamable HTTP** tại `/mcp` | Chuẩn hiện hành; KHÔNG dùng SSE legacy |
| Session mode | `stateless_http=true` | Scale ngang không cần session affinity; registry session nằm ở system SQLite do Sandbox Manager sở hữu, không ở gateway |
| **Auth (phase 1)** | **Mặc định không có** (zero-config); `MCP_API_KEY` **tùy chọn** cho CI/headless | Dev/demo nội bộ, không expose public; key do operator cấp, scope theo workspace (mục 12.5) — opt-in, không bắt buộc để chạy |
| Workspace auto-provision | Gateway tự sinh `workspace_id` (UUID) cho mỗi MCP session lần đầu; trả về trong response header; client dùng cho mọi tool call sau | Không cần "create workspace" — gọi tool đầu tiên là có |
| Body limit | Giữ mặc định ~4 MiB | Cố ý — buộc thiết kế đúng mục 6 |
| Host/Origin protection | Bật khi public hostname | Chống DNS rebinding |
| **Auth (phase 2 — dự phòng)** | OAuth 2.1 + Dynamic Client Registration | Khi cần public: client tự discovery + browser login; **không thay đổi URL contract** — chỉ thêm bước 401 → OAuth flow. Slot đã chừa sẵn, không phải refactor |

---

## 8. Xử lý lỗi & Kháng lỗi

| Tình huống | Hành vi |
| :--- | :--- |
| Provider thiếu capability | Tool không đăng ký; nếu gọi trực tiếp REST → `capability_unavailable` |
| Sandbox chết giữa command | Sandbox Manager phát hiện qua healthcheck → tự provision lại + resync toàn bộ manifest (idempotent, `requestId` mới) |
| Upload fail giữa multipart | Part lỗi retry riêng; URL hết hạn → xin lại URL cho **part đó**; `AbortMultipartUpload` khi client bỏ dở |
| sha256 mismatch lúc complete | Pointer stays `pending`; object cloud bị xóa; trả lỗi cho agent upload lại |
| Gateway restart | `stateless_http` → không mất gì; agent reconnect và dùng lại `session_id` |

### 8.1. Operation tracking & idempotency (backlog P1#7, P1#10)

Mọi thao tác thay đổi trạng thái (file write/edit/delete, git op, sandbox lifecycle, sync
push/pull) ghi 1 dòng vào bảng `operations` trong **system SQLite do Manager sở hữu** (mục
3.1) — nguồn thật duy nhất cho "việc gì đang/đã xảy ra", thay cho trạng thái trong bộ nhớ
process:

| Trường | Ý nghĩa |
| :--- | :--- |
| `op_id` | UUID nội bộ của operation |
| `request_id` | **Idempotency key** — Gateway sinh (UNIQUE); agent retry gửi lại cùng key (qua MCP `_meta` hoặc header) |
| `workspace_id`, `type`, `status` | `pending → running → done \| failed` |
| `result_digest` | Con dấu kết quả — dùng trả lại đúng response cũ khi retry |

Quy tắc retry: `request_id` đã tồn tại & `done` → **trả lại kết quả đã ghi, không thực thi
lại**; `running` → lỗi `operation_in_progress` (agent poll thay vì gọi lại); quá
`IDEMPOTENCY_TTL` (default 24h) → dọn dòng, retry bình thường. Không gửi `request_id` → sinh
mới: hành vi at-least-once như hiện nay, agent không bắt buộc phải thay đổi gì.

---

## 9. Lộ trình triển khai đề xuất (chờ duyệt)

| Phase | Phạm vi | Kết quả kiểm chứng được |
| :--- | :--- | :--- |
| **P1 — Provider contract** | Refactor `SandboxProvider` (thêm `capabilities`, `healthcheck`, `list_sandboxes`, `get_dial_target`; `sync_files` optional fallback) + `DockerProvider` (exec tạm qua Docker Exec API — bỏ khi P1.5 vào) + `FakeProvider` | 2 provider pass cùng 1 bộ conformance test |
| **P1.5 — gRPC exec agent** | Build agent binary (Exec/SyncFiles/Healthcheck/GetMetrics), golden image có sẵn agent, mTLS CA nội bộ, gRPC client ở Sandbox Manager; đường sync chính chuyển sang RPC `SyncFiles` | `command_run` end-to-end qua gRPC (không còn Docker Exec API / `pod/exec` ở Manager); conformance: tier mặc định bắt buộc, tier còn lại best-effort (cần hạ tầng) |
| **P2 — MCP Gateway core** | FastMCP service, transport Streamable HTTP, tool lifecycle + command (gọi Sandbox Manager REST) | Claude Code/Cursor gọi được `sandbox_create` → `command_run` end-to-end (runtime Docker) |
| **P3 — File & Git tools + Workspace Sync** | Tool file/git gọi VFS REST; **Workspace Sync coordinator** — push/pull delta, workspace revision, conflict detection, tombstone (thiết kế chi tiết: `docs/design/01-workspace-sync.md`) | CRUD file + fuzzy edit + git push chạy qua MCP; file sinh trong sandbox (build/test artifact) được pull-back về VFS, sống sót sandbox chết |
| **P4 — K8sProvider (prod)** | Pod + PVC + sidecar exec agent (sync qua RPC `SyncFiles`, mục 3.9) + Ingress endpoint + TTL cleanup | K8sProvider pass conformance; hybrid env `docker`/`k8s` hoạt động |
| **P5 — Cloud offload** | Presigned flow, multipart, schema `files` mở rộng, delta sync theo reference, cleanup | Upload file 500MB qua agent không chạm gateway; delete workspace dọn sạch cloud |
| **P6 — Hardening** | Host/origin protection, metrics, soak test, **chuyển sang OAuth 2.1 + Dynamic Client Registration khi cần public** | Load test + bảo mật checklist |

---

## 10. Tài liệu tham khảo

- MCP Protocol — Architecture & transports: <https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture>
- Filesystem MCP reference server (chuẩn tool file): <https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem>
- Docker Engine API — Exec / PutArchive / Stats: <https://docs.docker.com/engine/api/>
- Kubernetes — Pod Exec API & PersistentVolumeClaim: <https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/>
- FastMCP — HTTP deployment, stateless mode: <https://gofastmcp.com/v3/deployment/http>
- MCP Python SDK — running servers: <https://py.sdk.modelcontextprotocol.io/run/>
- S3 Multipart Upload (giới hạn part): <https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html>
- AWS — Patterns for API file upload (presigned URL): <https://aws.amazon.com/blogs/compute/patterns-for-building-an-api-to-upload-files-to-amazon-s3/>
- Tài liệu nội bộ: `sandbox-kit/docs/architecture.md`, `sandbox-kit/docs/vfs_architecture.md`, `sandbox-kit/docs/api_contract.md`, `sandbox-kit/broker/services/runtime/base.py`

---

## 11. Governance & Audit — mô hình 3 lớp

Mọi hành động của agent đều có dấu vết, nhưng audit ở **3 lớp** với mục đích khác nhau — tránh
ghi chồng chéo và giữ chi phí hợp lý:

| Lớp | Nơi ghi | Loại sự kiện | Mục đích | Retention |
| :--- | :--- | :--- | :--- | :--- |
| **1. Gateway intent** | MCP Gateway | `tools/call` request/response (metadata, không bytes): tool name, args schema, session_id, workspace_id, latency, error code | Truy vết **agent muốn gì** — phục vụ debug, billing, abuse detection | 30 ngày |
| **2. Sandbox Manager execution** | Sandbox Manager | Quyết định orchestration: provider được chọn, sandbox_id provisioned, sync delta, exec request, exit code, recovery event | Truy vết **hệ thống làm gì** — phục vụ incident response, capacity planning | 90 ngày |
| **3. Runtime technical** | Provider (Docker/K8s) + exec agent | Container lifecycle events, OOM, exec stdout/stderr (sampled), gRPC stream errors, mTLS handshake | Truy vết **runtime nói gì** — phục vụ debug sâu, performance tuning | 7 ngày (sampled) |

**Nguyên tắc:**

- **Không trùng lặp**: mỗi sự kiện chỉ thuộc 1 lớp chính. Ví dụ "command_run thất bại" — lớp 1
  ghi "agent gọi command_run, lỗi `exec_failed`"; lớp 2 ghi "exec agent trả exit 137 (OOM)"; lớp 3
  ghi "container OOMKilled tại timestamp X". Mỗi lớp trả lời 1 câu hỏi khác nhau.
- **Correlation ID**: mọi log mang `request_id` (sinh ở Gateway) truyền xuống Manager → agent →
  runtime. Tra cứu 1 ID ra được toàn bộ chuỗi.
- **Bytes không bao giờ vào log**: chỉ metadata (path, size, sha256). Nội dung file là vi phạm
  privacy ngay cả khi "chỉ để debug".
- **Audit log là append-only**, tách khỏi application log thường; phase 1 ghi local file, phase 2
  (khi public) ship về SIEM tập trung.

**Quyền truy cập audit log.** Phase 1: chỉ operator nội bộ. Phase 2: workspace owner xem được
log của workspace mình; admin xem toàn bộ.

---

## 12. Zero-config Onboarding

Mục tiêu: **agent cắm URL vào là chạy**, không cần config. Phase 1 (no-auth) đạt được trải nghiệm
này bằng 4 cơ chế:

### 12.1. Workspace auto-provision

Gateway tự sinh `workspace_id` (UUID) cho mỗi MCP session lần đầu, trả về trong response header
(vd `X-Workspace-Id`). Agent gọi tool đầu tiên là có workspace — không cần "create workspace"
trước. Mọi tool call sau dùng cùng `workspace_id` (Gateway nhớ theo MCP session).

**Contract `session_id` ↔ `workspace_id` (chốt):**

| Hạng mục | Quy ước |
| :--- | :--- |
| Cardinality | **1 workspace : N session** theo vòng đời (workspace bền hơn session); **1 session : 1 workspace** tại một thời điểm, không đổi giữa chừng |
| Ai resolve | **MCP Gateway** — nhận `session_id`, tự resolve ra `workspace_id` trước khi gọi Manager/VFS. Agent không bao giờ gửi `workspace_id` |
| Ai sở hữu gì | `workspace_id` sở hữu **dữ liệu** (VFS, cloud prefix, quota, sync state); `session_id` sở hữu **runtime** (sandbox mapping, exec) |
| Session chết | kill/expired → workspace **vẫn còn nguyên**; session mới kết nối cùng workspace thấy đúng trạng thái (ý nghĩa "bền" ở mục 3.1) |

### 12.2. Default profile

Mọi tool gọi được với **0 tham số bắt buộc** ngoài `session_id`:

| Tool | Default nếu không truyền |
| :--- | :--- |
| `sandbox_create` | image = golden image mặc định (đã cài sẵn toolchain phổ biến); cpu/mem/ttl theo profile; provider theo env; isolation theo profile |
| `command_run` | cwd = `/workspace`; timeout = 5 phút; env = rỗng |
| `file_write` | content inline nếu ≤ 2 MB (an toàn trong body ~4 MiB kể cả base64); tự chuyển sang presigned flow nếu lớn hơn |
| `git_clone` | shallow clone, branch mặc định |

Agent mới cắm vào, gọi tool đầu tiên → platform tự dựng tất cả. Điều chỉnh sau là tùy chọn,
không phải điều kiện.

### 12.3. Provider auto-detect

Sandbox Manager khởi động không cần flag: phát hiện `~/.kube/config` + in-cluster env → `k8s`;
có docker socket → `docker`; không có gì → `fake` + warning. Env var `SANDBOX_PROVIDER` chỉ
dùng khi muốn **ép** chọn, không phải để chạy được.

### 12.4. Credential vault (server-side)

Mọi credential hạ tầng (S3/MinIO, git token) sống **trong nền tảng**, không bao giờ lộ ra agent:

| Trước (agent phải config) | Sau (platform tự giải quyết) |
| :--- | :--- |
| S3 access key + secret | Gateway dùng credential service-side; presign theo identity |
| Git token cho push | Credential Vault per-workspace trên Sandbox Manager — operator cấu 1 lần, agent push không cần biết token |
| Domain/API endpoint của sandbox | Hard-code trong Gateway config, không lộ ra agent |
| `SANDBOX_PROVIDER`, threshold, TTL | Server-side default profile |

Không có secrets trong config agent = không có gì để config.

### 12.5. Trải nghiệm cuối cùng (phase 1)

- **Người dùng Claude/Cursor**: dán URL `https://mcp.<domain>/mcp` → chạy ngay, không key, không login.
- **CI/headless**: 1 env var `MCP_API_KEY` (cấp bởi operator, scope theo workspace).
- **Operator**: deploy Gateway với default profile, không phát hành gì cho ai.

### 12.6. Phase 2 (dự phòng) — OAuth 2.1 + Dynamic Client Registration

Khi cần public: client tự discovery + browser login; **không thay đổi URL contract** — chỉ thêm
bước 401 → OAuth flow. Slot đã chừa sẵn ở mục 7, không phải refactor.

---
