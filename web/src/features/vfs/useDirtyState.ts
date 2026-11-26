/**
 * useDirtyState — gói trạng thái "có thay đổi chưa lưu" của editor:
 * - state `dirty` để render badge, ref `dirtyRef` đọc TỨC THỜI trong callback/effect
 *   (guard, beforeunload) — hai giá trị luôn đồng bộ qua markDirty.
 * - askDiscard: hành động bị chặn khi dirty → mở ConfirmDialog hỏi bỏ thay đổi
 *   (thay cho confirm của trình duyệt); người dùng xác nhận thì chạy action.
 * - guardProps: spread trực tiếp lên <ConfirmDialog> của trang.
 * - Tự đăng ký cảnh báo rời trang (beforeunload) khi có thay đổi chưa lưu.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Hành động bị chặn vì có thay đổi chưa lưu — chờ người dùng xác nhận bỏ thay đổi. */
interface GuardedAction {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
}

export interface DirtyState {
  /** Giá trị render (state). */
  dirty: boolean;
  /** Giá trị đọc tức thời (ref) — dùng trong guard/effect không phụ thuộc re-render. */
  dirtyRef: React.RefObject<boolean>;
  /** Đặt cả hai cùng lúc. */
  markDirty: (value: boolean) => void;
  /** Có thay đổi chưa lưu → hỏi bỏ thay đổi trước khi chạy action; không thì chạy luôn. */
  askDiscard: (action: () => void) => void;
  /** Spread trực tiếp lên <ConfirmDialog>. */
  guardProps: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    busy: boolean;
    onConfirm: () => void;
    onClose: () => void;
  };
}

export function useDirtyState(): DirtyState {
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [guard, setGuard] = useState<GuardedAction | null>(null);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const askDiscard = useCallback((action: () => void) => {
    if (dirtyRef.current) {
      setGuard({
        title: "Thay đổi chưa lưu",
        message: "Nội dung đang sửa chưa được lưu. Bỏ qua thay đổi và tiếp tục?",
        confirmLabel: "Bỏ thay đổi",
        action,
      });
      return;
    }
    action();
  }, []);

  // ---- Cảnh báo rời trang khi có thay đổi chưa lưu ----
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const guardProps = {
    open: guard !== null,
    title: guard?.title ?? "",
    message: guard?.message ?? "",
    confirmLabel: guard?.confirmLabel ?? "Xác nhận",
    busy: false,
    onConfirm: () => {
      const action = guard?.action;
      setGuard(null);
      action?.();
    },
    onClose: () => setGuard(null),
  };

  return { dirty, dirtyRef, markDirty, askDiscard, guardProps };
}
