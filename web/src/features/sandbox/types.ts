/**
 * types.ts — shape dữ liệu trả về từ /admin/api (xem admin_sandbox_api.py).
 * Các trường tùy chọn phản ánh đúng backend: provider nào thiếu tính năng → bỏ key.
 */

export type SessionState = "STANDBY" | "STARTING" | "RUNNING" | "PAUSED";

/** Trạng thái đồng bộ VFS → sandbox (sync_state.status). */
export type SyncStatus = "syncing" | "synced" | "stale" | "no_sandbox";

export interface SyncInfo {
  workspace_revision?: number;
  status?: SyncStatus;
  sandbox_id?: string | null;
  synced_revision?: number | null;
  pending_push?: number;
  pending_put?: number;
  pending_delete?: number;
}

/** Một dòng phiên từ GET /sandboxes (ghép DB + provider). */
export interface SessionRow {
  session_id: string;
  workspace_id: string;
  sandbox_id: string | null;
  state: SessionState;
  expires_at: string | null;
  created_at: string;
  /** Bổ sung bởi GET /sandboxes: */
  workspace_name?: string | null;
  provider_state?: string | null;
  drift?: boolean;
  sync?: SyncInfo | null;
}

/** Sandbox provider còn giữ nhưng không phiên nào trỏ tới. */
export interface OrphanRow {
  sandbox_id: string;
  state?: string;
  session_id?: string | null;
  created_at?: string | null;
}

export interface ProviderCapabilities {
  pause_resume?: boolean;
  diagnostics?: boolean;
  [key: string]: boolean | undefined;
}

export interface Overview {
  provider: string;
  capabilities: ProviderCapabilities;
  image: string;
  sessions: SessionRow[];
  orphans: OrphanRow[];
}

/** describe_sandbox — thông tin container thật. */
export interface ContainerInfo {
  sandbox_id: string;
  session_id?: string | null;
  state?: string;
  docker_status?: string;
  image?: string;
  created_at?: string | null;
  started_at?: string | null;
  exit_code?: number | null;
  oom_killed?: boolean;
  expires_at?: string | null;
  dial_target?: string | null;
  volume?: string | null;
  cpu?: number | null;
  memory_mb?: number | null;
  network?: string | null;
  /** Provider lỗi khi mô tả → hiển thị message thay vì im lặng. */
  error?: { code?: string; message?: string };
}

export interface WorkspaceFile {
  path: string;
  size?: number | null;
}

export interface WorkspaceListing {
  files?: WorkspaceFile[];
  total?: number;
  truncated?: boolean;
  error?: { code?: string; message?: string };
}

export interface SandboxMetrics {
  available?: boolean;
  reason?: string;
  cpu_percent?: number;
  memory_bytes?: number;
  memory_limit_bytes?: number;
  pids?: number | null;
}

export interface SandboxDetail {
  sandbox_id: string;
  info?: ContainerInfo;
  metrics?: SandboxMetrics;
  workspace?: WorkspaceListing;
}

export interface LogsResult {
  available: boolean;
  logs?: string;
}

export interface FileContent {
  path: string;
  size?: number;
  truncated?: boolean;
  encoding?: "utf-8" | "base64";
  content: string;
}

/** POST /sessions/{id}/start. */
export interface StartResult {
  sandbox_id: string;
  materialized_files?: number;
  synced_revision?: number;
  expires_at?: string | null;
}

/** POST /sessions/{id}/{stop|pause|resume}. */
export interface StateResult {
  state?: string;
  expires_at?: string | null;
}

/** POST /sessions/{id}/sync. */
export interface SyncResult {
  skipped?: boolean;
  put?: number;
  deleted?: number;
  revision?: number;
}

/** GET /sessions/{id}/compare — so sha256 kho ↔ sandbox. */
export interface CompareResult {
  revision?: number | null;
  watermark?: number | null;
  status?: SyncStatus;
  same: number;
  differ: Array<{ path: string; vfs_sha256: string; sandbox_sha256: string }>;
  only_vfs: string[];
  only_sandbox: Array<{ path: string; size?: number | null }>;
  in_sync: boolean;
}

/** POST /algo/policy — kiểm lệnh KHÔNG chạy thật. */
export interface PolicyHit {
  rule: string;
  layer: number;
  message: string;
  match: string;
}

export interface PolicyResult {
  blocked: boolean;
  modes: { layer1: string; layer2: string };
  hits: PolicyHit[];
  warnings: string[];
}

/** Thân request POST /sessions/{id}/exec. */
export interface ExecBody {
  command: string;
  cwd?: string;
  timeout_seconds?: number;
}

/** Kết quả cuối của exec (event "result"). */
export interface ExecResultData {
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
  truncated?: boolean;
  error_detail?: string;
}

/** Từng dòng NDJSON của exec stream. */
export type ExecEvent =
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | {
      type: "prepared";
      sync?: SyncResult;
      policy?: { warnings?: string[]; modes?: { layer1?: string; layer2?: string } };
      revision?: number;
    }
  | ({ type: "result" } & ExecResultData)
  | { type: "error"; error: { code: string; message: string } };
