/**
 * types.ts — kiểu dữ liệu trả về từ /admin/api/* và /upload/* (xem admin_api.py, upload.py).
 * Trường tùy chọn đánh dấu `?` vì backend có thể không trả ở mọi nhánh.
 */

/** Ngưỡng cấu hình VFS (GET /admin/api/overview). */
export interface OverviewSettings {
  data_dir: string;
  inline_max_bytes: number;
  blob_sidecar_min_bytes: number;
  workspace_quota_bytes: number;
  max_revisions_per_file: number;
}

/** Một dòng trong danh sách workspace (bản ghi store + thống kê DB dự án). */
export interface WorkspaceSummaryItem {
  id: string;
  created_at?: string;
  conflict_policy?: string | null;
  name?: string | null;
  demonstrates?: string | null;
  session_id?: string | null;
  /** DB dự án chưa tạo (workspace mới qua manager). */
  missing_db?: boolean;
  revision?: number;
  file_count?: number;
  blob_count?: number;
  tombstone_count?: number;
  used_bytes?: number;
}

export interface Overview {
  settings: OverviewSettings;
  workspaces: WorkspaceSummaryItem[];
}

/** Một file trong cây (bảng files + nhãn quy tắc không lưu). */
export interface VfsFileRow {
  path: string;
  size: number;
  sha256: string;
  rev: number;
  storage_class: string;
  blob_ref: string | null;
  synced_sha256: string | null;
  mtime: string | null;
  is_binary: boolean;
  ignored?: boolean;
  history_count?: number;
}

export interface Tombstone {
  path: string;
  rev: number;
  origin: string;
  sha256: string;
}

export interface OperationRow {
  created_at: string;
  type: string;
  status: string;
  sandbox_id?: string | null;
}

export interface SessionRow {
  state: string;
  sandbox_id?: string | null;
  session_id?: string;
}

export interface WorkspaceDetail {
  workspace: { id: string; created_at?: string };
  name?: string | null;
  demonstrates?: string | null;
  summary: {
    revision: number;
    conflict_policy: string | null;
    file_count: number;
    blob_count: number;
    tombstone_count: number;
    used_bytes: number;
  };
  quota_bytes: number;
  sessions: SessionRow[];
  files: VfsFileRow[];
  tombstones: Tombstone[];
  operations: OperationRow[];
}

/** Một bản lịch sử của file. */
export interface Revision {
  id: number;
  created_at: string;
  before_sha: string;
  after_sha: string;
  /** Toàn văn sau thay đổi (hoặc placeholder "[full-content-skipped:…]"). */
  patch: string;
  restorable?: boolean;
}

export type FileEncoding = "utf-8" | "base64" | "none";

/** Kết quả GET /workspaces/{id}/file — metadata + nội dung + lịch sử. */
export interface FileDetail extends VfsFileRow {
  encoding: FileEncoding;
  content?: string;
  ignored: boolean;
  download_url: string;
  revisions: Revision[];
}

/** Kết quả ghi/xóa/khôi phục chung: {path, rev, noop?}. */
export interface WriteResult {
  path: string;
  rev: number;
  noop?: boolean;
}

/** POST /workspaces/{id}/edit — dry_run=true trả before/after, ngược lại trả kết quả ghi. */
export interface EditDryRunResult {
  dry_run: true;
  used_fuzzy: boolean;
  before: string;
  after: string;
}

export interface EditApplyResult {
  path: string;
  rev: number;
  used_fuzzy?: boolean;
}

export type EditResult = EditDryRunResult | EditApplyResult;

export interface MoveResult {
  written: WriteResult;
  deleted: WriteResult;
}

/** POST /admin/api/algo/path — lỗi nghiệp vụ trả dạng dữ liệu (ok=false). */
export interface PathAlgoResult {
  input: string;
  ok: boolean;
  canonical?: string;
  changed?: boolean;
  ignore_reason?: string | null;
  error?: { code: string; message: string };
}

/** POST /admin/api/algo/fuzzy — mức 1 chính xác / mức 2 mờ / mức 3 lỗi. */
export interface FuzzyAlgoResult {
  ok: boolean;
  level?: number;
  used_fuzzy?: boolean;
  result?: string;
  error?: { code: string; message: string };
}

/** POST /upload — khai báo phiên upload theo phần. */
export interface UploadInitResult {
  token: string;
  upload_url: string;
  chunk_size: number;
  state: string;
}

export interface UploadCompleteResult {
  workspace_id: string;
  path: string;
  sha256: string;
  size: number;
  storage: string;
  rev: number | null;
}
