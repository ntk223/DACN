/**
 * Điều hướng "Quản lý → Thao tác" kèm đối tượng được chọn.
 *
 * Trang Quản lý gọi callback `onOpenOps(...)` do App cung cấp; App cập nhật
 * payload và chuyển trang; trang Thao tác nhận `navRequest` để chọn đúng
 * đối tượng (workspace/file, sandbox) khi mount.
 */

/** Yêu cầu mở VFS · Thao tác tại một workspace (và file nếu có). */
export interface VfsOpsRequest {
  workspaceId?: string;
  /** Đường dẫn file cần mở sẵn trong editor (tuỳ chọn). */
  file?: string;
  /** Tăng mỗi lần phát yêu cầu — trang đích phản ứng cả khi giá trị trùng lần trước. */
  nonce: number;
}

/** Yêu cầu mở Sandbox · Thao tác tại một phiên (đang có sandbox). */
export interface SandboxOpsRequest {
  sessionId: string;
  nonce: number;
}

/** Yêu cầu mở VFS · Quản lý tại một workspace (và file nếu có). */
export interface VfsManageRequest {
  workspaceId?: string;
  file?: string;
  nonce: number;
}

export type OpenVfsOps = (workspaceId?: string, file?: string) => void;
export type OpenSandboxOps = (sessionId: string) => void;
export type OpenVfsManage = (workspaceId?: string, file?: string) => void;
