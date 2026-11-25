import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Bấm nút X / phím Esc / click nền — caller tự đổi state. */
  onClose: () => void;
  /** Bề rộng tối đa của hộp thoại, mặc định 520px. */
  width?: number;
  children: ReactNode;
}

/** Hộp thoại overlay đơn giản: đóng khi Esc hoặc click nền. */
export function Modal({ open, title, onClose, width = 520, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
        background: "rgba(15, 23, 42, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
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
            padding: "14px 20px",
            borderBottom: "1px solid var(--color-border)",
            fontWeight: 600,
          }}
        >
          <div>{title}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Đóng"
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
