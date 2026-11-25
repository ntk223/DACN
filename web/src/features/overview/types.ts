/**
 * types.ts — kiểu dữ liệu trả về của REST /admin/api/* (chỉ lấy field UI cần).
 * Nguồn tham chiếu: src/sandbox_kit_clone/gateway/admin_api.py, admin_sandbox_api.py.
 */

/** Ngưỡng cấu hình từ GET /admin/api/overview. */
export interface AdminSettings {
  data_dir: string;
  inline_max_bytes: number;
  blob_sidecar_min_bytes: number;
  workspace_quota_bytes: number;
  max_revisions_per_file: number;
}

/** 1 dòng workspace trong GET /admin/api/overview (gộp thêm thống kê DB dự án). */
export interface WorkspaceRow {
  id: string;
  status: string;
  created_at: string;
  /** Nhãn từ seed-manifest.json — có thể không có. */
  name?: string | null;
  demonstrates?: string | null;
  /** Session đầu tiên của workspace (nếu có). */
  session_id?: string | null;
  revision?: number;
  conflict_policy?: string | null;
  file_count?: number;
  blob_count?: number;
  tombstone_count?: number;
  used_bytes?: number;
  missing_db?: boolean;
}

/** Response GET /admin/api/overview. */
export interface OverviewResponse {
  settings: AdminSettings;
  workspaces: WorkspaceRow[];
}

/** 1 dòng session trong DB hệ thống (schema.py §6.3). */
export interface SessionRow {
  session_id: string;
  workspace_id: string;
  sandbox_id?: string | null;
  /** STANDBY | STARTING | RUNNING | PAUSED */
  state: string;
  expires_at?: string | null;
  created_at: string;
  provider_state?: string | null;
  drift?: string | null;
}

/** Response GET /admin/api/sandboxes (manager.sandbox_overview). */
export interface SandboxOverviewResponse {
  provider: string;
  sessions: SessionRow[];
  orphans: Array<{ sandbox_id: string }>;
}

/** Response GET /admin/api/workspaces/{id} — chỉ dùng phần sessions. */
export interface WorkspaceDetailResponse {
  workspace: { id: string; status: string; created_at: string };
  name?: string | null;
  sessions: SessionRow[];
}

/** Response POST /admin/api/workspaces (qua Manager.create_workspace). */
export interface CreateWorkspaceResponse {
  workspace_id: string;
  session_id: string;
}

/** Response POST /upload (khởi tạo phiên upload theo phần). */
export interface UploadInitResponse {
  token: string;
  upload_url: string;
  chunk_size: number;
  state: string;
}

/** Response POST /upload/{token}/complete. */
export interface UploadCompleteResponse {
  workspace_id: string;
  path: string;
  sha256: string;
  size: number;
  /** "vfs" | "blob" */
  storage: string;
  rev: number | null;
}
