/**
 * Toast.tsx — thông báo ngắn góc phải dưới (thành công / lỗi / cảnh báo).
 * Tự biến mất sau vài giây; lỗi giữ lâu hơn.
 */
import { useCallback, useRef, useState } from "react";

export type ToastKind = "ok" | "err" | "warn";

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const DURATION_MS: Record<ToastKind, number> = { ok: 3500, warn: 5000, err: 7000 };

/** Quản lý stack toast cho một trang. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = "ok") => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURATION_MS[kind]);
  }, []);

  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="sbx-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`sbx-toast sbx-toast-${toast.kind}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
