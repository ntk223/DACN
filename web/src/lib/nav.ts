/**
 * Điều hướng "Quản lý → Thao tác" kèm đối tượng được chọn.
 *
 * Trang Quản lý gọi callback `onOpenOps(...)` do App cung cấp; App cập nhật
 * payload và chuyển trang; trang Thao tác nhận `navRequest` để chọn đúng
 * đối tượng (workspace/file, sandbox) khi mount.
 */

import { useEffect, useRef } from "react";

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

/**
 * useNavEffect — đóng gói pattern "chỉ phản ứng navRequest khi nonce MỚI hơn lần trước"
 * (trước đây lặp lại ở VfsOpsPage / VfsManagePage / SandboxOpsPage).
 *
 * Dùng trong trang đích:
 *   useNavEffect(navRequest, (req) => { setWsId(req.workspaceId); ... });
 *
 * - request undefined → không làm gì (vào trang qua sidebar thì giữ nguyên lựa chọn).
 * - nonce bằng hoặc cũ hơn lần đã xử lý → bỏ qua (ref nội bộ, caller không cần ref riêng).
 * - handler luôn là bản mới nhất mỗi lần effect chạy (không cần liệt kê vào deps).
 */
export function useNavEffect<T extends { nonce: number }>(
  request: T | undefined,
  handler: (req: T) => void,
): void {
  // Giữ handler mới nhất trong ref để effect không phụ thuộc closure cũ.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Nonce đã xử lý gần nhất — null nghĩa là chưa có yêu cầu nào.
  const lastNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (request === undefined) return;
    if (lastNonceRef.current !== null && request.nonce <= lastNonceRef.current) return;
    lastNonceRef.current = request.nonce;
    handlerRef.current(request);
  }, [request]);
}
