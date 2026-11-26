import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

interface RenameModalProps {
  open: boolean;
  /** Đường dẫn hiện tại của file. */
  path: string;
  busy: boolean;
  /** Gọi với đường dẫn mới đã trim khi người dùng xác nhận. */
  onConfirm: (dst: string) => void;
  onClose: () => void;
}

/**
 * Modal "Đổi tên / di chuyển": input đường dẫn mới + preview đường dẫn đích
 * (thay cho hộp prompt của trình duyệt cũ — xem trước trước khi ghi).
 */
export function RenameModal({ open, path, busy, onConfirm, onClose }: RenameModalProps) {
  const [dst, setDst] = useState(path);

  // Mỗi lần mở modal: đặt lại input theo path hiện tại.
  useEffect(() => {
    if (open) setDst(path);
  }, [open, path]);

  const trimmed = dst.trim();
  const changed = trimmed.length > 0 && trimmed !== path;

  return (
    <Modal
      open={open}
      title="Đổi tên / di chuyển file"
      onClose={busy ? () => undefined : onClose}
      width={560}
    >
      <div className="vfs-dim vfs-small" style={{ marginBottom: 12 }}>
        Nhập đường dẫn mới — có thể đổi cả tên file lẫn thư mục đích. Nguồn sẽ để lại dấu xóa.
      </div>
      <div className="vfs-frame">
        <span className="vfs-frame-label">Đường dẫn hiện tại</span>
        <span className="vfs-frame-path mono">{path}</span>
      </div>
      <div className="vfs-frame">
        <label className="vfs-frame-label" htmlFor="vfs-rename-dst">
          Đường dẫn mới
        </label>
        <input
          id="vfs-rename-dst"
          className="input mono"
          value={dst}
          autoFocus
          spellCheck={false}
          onChange={(e) => setDst(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && changed && !busy) onConfirm(trimmed);
          }}
        />
      </div>
      <div className={`vfs-move-preview${changed ? " vfs-move-preview-changed" : ""}`}>
        {changed ? (
          <>
            {path} <span aria-hidden="true">→</span> <b className="mono">{trimmed}</b>
          </>
        ) : (
          "Nhập một đường dẫn khác đường dẫn hiện tại để di chuyển."
        )}
      </div>
      <div className="vfs-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <Button size="sm" disabled={busy} onClick={onClose}>
          Hủy
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!changed}
          onClick={() => onConfirm(trimmed)}
        >
          Đổi tên
        </Button>
      </div>
    </Modal>
  );
}
