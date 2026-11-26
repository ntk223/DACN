/**
 * CreateWorkspaceModal.tsx — modal "Tạo workspace" tách từ VfsOpsPage:
 * tên (tuỳ chọn — để trống tự sinh id) + chính sách xung đột ghi.
 * Modal tự gọi POST; khi tạo xong báo onCreated(workspaceId) để caller
 * refresh danh sách và chọn workspace mới (giữ nguyên luồng của bản cũ).
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { ToastKind } from "@/components/Toast";
import { errorMessage, vfsApi } from "./vfsApi";

interface CreateWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  onToast: (message: string, kind: ToastKind) => void;
  /** Tạo thành công → caller refresh overview + chọn workspace mới. */
  onCreated: (workspaceId: string) => Promise<void>;
}

/**
 * Kiểm tra nhẹ TẠI CLIENT trước khi gọi API: tên trống là hợp lệ (tự sinh id),
 * chỉ chặn ký tự chắc chắn hỏng — "/", "\" và ký tự điều khiển. Trả thông báo
 * lỗi hoặc null nếu tên dùng được.
 */
function nameError(name: string): string | null {
  if (/[/\\\x00-\x1f\x7f]/.test(name)) {
    return "Tên không được chứa “/”, “\\” hoặc ký tự điều khiển.";
  }
  return null;
}

export function CreateWorkspaceModal({ open, onClose, onToast, onCreated }: CreateWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState("sandbox_wins");
  const [busy, setBusy] = useState(false);

  // Mỗi lần mở modal: reset về mặc định (như bản cũ reset sau khi tạo xong).
  useEffect(() => {
    if (open) {
      setName("");
      setPolicy("sandbox_wins");
    }
  }, [open]);

  const nameInvalid = nameError(name);

  const submit = async () => {
    // Tên không hợp lệ → chặn tại đây, không gọi API (thông báo inline đã hiện).
    if (busy || nameInvalid !== null) return;
    setBusy(true);
    try {
      const result = await vfsApi.createWorkspace(name.trim(), policy);
      onToast(`Đã tạo workspace ${result.workspace_id}`, "success");
      // Đóng modal TRƯỚC khi refresh (như bản cũ: setCreateOpen(false) trước await).
      onClose();
      await onCreated(result.workspace_id);
    } catch (error) {
      onToast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Tạo workspace" onClose={busy ? () => undefined : onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="vfs-small vfs-dim" htmlFor="vfs-create-name">
            Tên (tuỳ chọn — để trống sẽ tự sinh id)
          </label>
          <input
            id="vfs-create-name"
            className="input"
            value={name}
            placeholder="vd: demo-notes"
            autoFocus
            aria-invalid={nameInvalid !== null}
            aria-describedby={nameInvalid !== null ? "vfs-create-name-error" : undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {nameInvalid !== null ? (
            <div
              id="vfs-create-name-error"
              className="vfs-small"
              style={{ color: "var(--color-danger)" }}
              role="alert"
            >
              {nameInvalid}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="vfs-small vfs-dim" htmlFor="vfs-create-policy">
            Chính sách xung đột ghi
          </label>
          <select
            id="vfs-create-policy"
            className="select"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
          >
            <option value="sandbox_wins">sandbox_wins</option>
            <option value="error">error</option>
          </select>
        </div>
        <div className="vfs-row" style={{ justifyContent: "flex-end" }}>
          <Button size="sm" disabled={busy} onClick={() => (busy ? undefined : onClose())}>
            Hủy
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={nameInvalid !== null}
            onClick={() => void submit()}
          >
            Tạo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
