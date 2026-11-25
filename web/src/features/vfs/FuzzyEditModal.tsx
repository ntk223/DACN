import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { ToastKind } from "./Toast";
import { errorMessage, vfsApi } from "./vfsApi";
import { LineDiffView } from "./LineDiffView";

interface FuzzyEditModalProps {
  open: boolean;
  wsId: string;
  path: string;
  /** old_text khởi tạo: đoạn đang chọn (hoặc toàn bộ nội dung file đã lưu). */
  initialText: string;
  /** true khi initialText là đoạn bôi đen trong trình sửa. */
  fromSelection: boolean;
  onClose: () => void;
  /** Gọi sau khi áp dụng thành công để parent refresh. */
  onApplied: () => void;
  onToast: (message: string, kind: ToastKind) => void;
}

/**
 * Modal "Sửa khớp mờ": old_text/new_text → POST /edit
 * (Xem trước = dry_run trả diff; Áp dụng = ghi thật, mức 1 chính xác → mức 2 mờ).
 */
export function FuzzyEditModal({
  open,
  wsId,
  path,
  initialText,
  fromSelection,
  onClose,
  onApplied,
  onToast,
}: FuzzyEditModalProps) {
  const [oldText, setOldText] = useState(initialText);
  const [newText, setNewText] = useState(initialText);
  const [status, setStatus] = useState<{ tone: "dim" | "ok" | "err"; text: string }>({
    tone: "dim",
    text: fromSelection
      ? "old_text = đoạn đang chọn"
      : "old_text = toàn bộ nội dung file — sửa bên phải rồi Xem trước",
  });
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Mỗi lần mở modal: khởi tạo lại old/new theo đoạn truyền vào.
  useEffect(() => {
    if (open) {
      setOldText(initialText);
      setNewText(initialText);
      setPreview(null);
      setStatus({
        tone: "dim",
        text: fromSelection
          ? "old_text = đoạn đang chọn"
          : "old_text = toàn bộ nội dung file — sửa bên phải rồi Xem trước",
      });
    }
  }, [open, initialText, fromSelection]);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const result = await vfsApi.edit(wsId, { path, old_text: oldText, new_text: newText, dry_run: dryRun });
      if (result === null) throw new Error("Phản hồi rỗng từ máy chủ");
      if ("before" in result) {
        // Nhánh dry_run: xem trước diff, chưa ghi gì.
        setPreview({ before: result.before, after: result.after });
        setStatus({
          tone: "ok",
          text: result.used_fuzzy ? "Mức 2 — khớp mờ (chuẩn hóa khoảng trắng, giữ indent gốc)" : "Mức 1 — khớp chính xác đúng 1 lần",
        });
      } else {
        // Nhánh áp dụng: đã ghi, refresh rồi đóng.
        onToast(
          `Đã sửa · rev ${result.rev}${result.used_fuzzy === true ? " · khớp mờ" : ""}`,
          "success",
        );
        onApplied();
        onClose();
      }
    } catch (error) {
      // Mức 3 — không tìm được khớp.
      setStatus({ tone: "err", text: `Mức 3 — ${errorMessage(error)}` });
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const statusColor = status.tone === "ok" ? "var(--color-success)" : status.tone === "err" ? "var(--color-danger)" : "var(--color-text-muted)";

  return (
    <Modal open={open} title={`Sửa khớp mờ — ${path}`} onClose={busy ? () => undefined : onClose} width={760}>
      <div className="vfs-dim vfs-small" style={{ marginBottom: 10 }}>
        Mức 1 chính xác → mức 2 chuẩn hóa khoảng trắng (giữ indent gốc) → mức 3 báo lỗi.
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="vfs-dim vfs-small">old_text</span>
        <textarea className="textarea" rows={5} value={oldText} onChange={(e) => setOldText(e.target.value)} spellCheck={false} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
        <span className="vfs-dim vfs-small">new_text</span>
        <textarea className="textarea" rows={5} value={newText} onChange={(e) => setNewText(e.target.value)} spellCheck={false} />
      </label>
      <div className="vfs-row" style={{ marginTop: 10 }}>
        <span className="vfs-small vfs-grow" style={{ color: statusColor }}>
          {status.text}
        </span>
        <Button size="sm" disabled={busy} onClick={() => void run(true)}>
          Xem trước
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void run(false)}>
          Áp dụng
        </Button>
      </div>
      {preview !== null ? (
        <div style={{ marginTop: 10 }}>
          <LineDiffView before={preview.before} after={preview.after} maxHeight={280} />
        </div>
      ) : null}
    </Modal>
  );
}
