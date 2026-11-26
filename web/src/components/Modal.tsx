import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Bấm nút X / phím Esc / click nền — caller tự đổi state. */
  onClose: () => void;
  /** Bề rộng tối đa của hộp thoại, mặc định 520px. */
  width?: number;
  children: ReactNode;
}

/** Selector cho các element có thể focus bên trong hộp thoại. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Hộp thoại overlay: đóng khi Esc hoặc click nền; focus bị kẹp trong modal (Tab vòng),
 * khi mở focus vào control đầu tiên, khi đóng trả focus về element trước đó.
 */
export function Modal({ open, title, onClose, width = 520, children }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Nhớ element đang focus trước khi mở để trả lại khi đóng.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    /** Danh sách element focus-able hiện có trong hộp thoại. */
    const focusables = (): HTMLElement[] => {
      const dialog = dialogRef.current;
      if (dialog === null) return [];
      return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute("aria-hidden"),
      );
    };

    // Mở → focus control đầu tiên (không có thì focus chính hộp thoại).
    const first = focusables()[0];
    if (first !== undefined) first.focus();
    else dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Focus trap: Tab / Shift+Tab luôn vòng trong danh sách của modal.
      const list = focusables();
      const dialog = dialogRef.current;
      if (dialog === null) return;
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = list[0] as HTMLElement;
      const lastEl = list[list.length - 1] as HTMLElement;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && dialog.contains(active);
      if (event.shiftKey) {
        if (!inside || active === firstEl) {
          event.preventDefault();
          lastEl.focus();
        }
      } else if (!inside || active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Đóng → trả focus về nơi đã gọi modal.
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        // Chỉ đóng khi click trực tiếp vào nền, không phải vào hộp thoại.
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-overlay)",
          width: "100%",
          maxWidth: width,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border)",
            fontWeight: 650,
            fontSize: "var(--font-size-lg)",
            color: "var(--color-text)",
          }}
        >
          <div id={titleId}>{title}</div>
          <button
            type="button"
            className="modal-close"
            aria-label="Đóng"
            title="Đóng (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}
