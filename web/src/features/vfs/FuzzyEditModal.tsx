import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
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

/** 0 = chưa chạy; 1 = chính xác; 2 = khớp mờ; 3 = không khớp. */
type MatchLevel = 0 | 1 | 2 | 3;

const LEVEL_INFO: Record<Exclude<MatchLevel, 0>, { tone: "green" | "yellow" | "red"; label: string; desc: string }> = {
  1: { tone: "green", label: "Mức 1", desc: "Khớp chính xác đúng 1 lần — thay thế trực tiếp." },
  2: { tone: "yellow", label: "Mức 2", desc: "Khớp mờ — chuẩn hóa khoảng trắng, giữ indent gốc." },
  3: { tone: "red", label: "Mức 3", desc: "Không tìm được khớp — kiểm tra lại old_text." },
};

/**
 * Modal "Sửa khớp mờ": 2 khung old/new rõ nhãn → POST /edit
 * (Xem trước = dry_run trả diff; Áp dụng = ghi thật, mức 1 chính xác → mức 2 mờ).
 * Mức khớp hiển thị badge to có màu + mô tả ngắn.
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
  const [level, setLevel] = useState<MatchLevel>(0);
  const [errDetail, setErrDetail] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Mỗi lần mở modal: khởi tạo lại old/new theo đoạn truyền vào.
  useEffect(() => {
    if (open) {
      setOldText(initialText);
      setNewText(initialText);
      setPreview(null);
      setLevel(0);
      setErrDetail(null);
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
        setLevel(result.used_fuzzy ? 2 : 1);
        setErrDetail(null);
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
      setLevel(3);
      setErrDetail(errorMessage(error));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={`Sửa khớp mờ — ${path}`} onClose={busy ? () => undefined : onClose} width={760}>
      <div className="vfs-dim vfs-small">
        Mức 1 chính xác → mức 2 chuẩn hóa khoảng trắng (giữ indent gốc) → mức 3 báo lỗi.
      </div>

      <div className="vfs-frame">
        <span className="vfs-frame-label">old_text — văn bản cần tìm</span>
        <textarea
          className="textarea"
          rows={5}
          value={oldText}
          onChange={(e) => setOldText(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="vfs-frame">
        <span className="vfs-frame-label">new_text — nội dung thay thế</span>
        <textarea
          className="textarea"
          rows={5}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          spellCheck={false}
        />
      </div>

      {level !== 0 ? (
        <div className="vfs-levelbox">
          <Badge tone={LEVEL_INFO[level].tone}>{LEVEL_INFO[level].label}</Badge>
          <span className="vfs-levelbox-desc">
            {LEVEL_INFO[level].desc}
            {level === 3 && errDetail !== null ? <span className="mono"> — {errDetail}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="vfs-row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <Button size="sm" disabled={busy} onClick={() => void run(true)}>
          Xem trước
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void run(false)}>
          Áp dụng
        </Button>
      </div>

      {preview !== null ? (
        <div style={{ marginTop: 12 }}>
          <div className="vfs-frame">
            <span className="vfs-frame-label">Xem trước thay đổi (dry-run — chưa ghi gì)</span>
            <div style={{ padding: 8 }}>
              <LineDiffView before={preview.before} after={preview.after} maxHeight={280} />
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
