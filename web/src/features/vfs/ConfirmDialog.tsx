import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Nút xác nhận màu đỏ (dùng cho hành động phá hủy). */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Hộp thoại xác nhận dùng chung trong feature VFS (xóa file, khôi phục bản…). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Xác nhận",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} onClose={busy ? () => undefined : onClose} width={440}>
      <div style={{ marginBottom: 16 }}>{message}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button size="sm" disabled={busy} onClick={onClose}>
          Hủy
        </Button>
        <Button size="sm" variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
