/**
 * useVfsShortcuts — phím tắt toàn cục của trang VFS · Thao tác:
 * N (file mới), R (tải lại). Ctrl+S do FileEditor xử lý riêng.
 */
import { useEffect } from "react";

/** Đang gõ trong input/textarea/select thì không bắt phím tắt N/R. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

interface VfsShortcutsOptions {
  /** Chưa chọn workspace thì phím N không có tác dụng (như bản cũ). */
  wsId: string | null;
  onNewFile: () => void;
  onReload: () => void;
}

/** Đăng ký 1 listener keydown toàn cục trong suốt vòng đời trang. */
export function useVfsShortcuts({ wsId, onNewFile, onReload }: VfsShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "n" || event.key === "N") {
        if (wsId !== null) {
          event.preventDefault();
          onNewFile();
        }
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void onReload();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wsId, onNewFile, onReload]);
}
