import { useCallback, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Hook quản lý danh sách toast — tự xóa sau vài giây (lỗi giữ lâu hơn). */
export function useToasts(): { toasts: ToastItem[]; push: (message: string, kind?: ToastKind) => void } {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = "success") => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    const ttl = kind === "error" ? 7000 : 3500;
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, ttl);
  }, []);

  return { toasts, push };
}

/** Cố định góc phải-dưới, xếp chồng; màu viền trái theo loại. */
export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="vfs-toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`vfs-toast vfs-toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
