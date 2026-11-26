/**
 * Toast.tsx — bộ toast dùng chung (hợp nhất features/vfs/Toast + features/sandbox/Toast).
 * Quy ước kind đầy đủ: success | error | warn | info; class .toast-* của base.css.
 * Góc phải dưới, tự biến mất sau vài giây (lỗi giữ lâu hơn); aria-live cho screen reader.
 */
import { useCallback, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Thời gian hiển thị theo loại (ms) — lỗi giữ lâu hơn để kịp đọc. */
const DURATION_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 3500,
  warn: 5000,
  error: 7000,
};

const KIND_CLASS: Record<ToastKind, string> = {
  success: "toast--success",
  error: "toast--error",
  warn: "toast--warn",
  info: "toast--info",
};

/** Hook quản lý danh sách toast cho một trang — push(message, kind?) tự xóa theo TTL. */
export function useToasts(): {
  toasts: ToastItem[];
  push: (message: string, kind?: ToastKind) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = "success") => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, DURATION_MS[kind]);
  }, []);

  return { toasts, push };
}

/** Cố định góc phải-dưới, xếp chồng; màu viền trái theo loại. Có aria-live. */
export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${KIND_CLASS[toast.kind]}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
