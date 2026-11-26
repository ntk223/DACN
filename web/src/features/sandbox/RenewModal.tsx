/**
 * RenewModal.tsx — modal Gia hạn TTL (tách từ SandboxOpsPage, port từ bảng
 * Quản lý cũ): hỏi số phút cộng vào thời hạn hiện tại, validation inline.
 */
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import type { ToastKind } from "@/components/Toast";
import { useState } from "react";
import { sandboxApi } from "./sandboxApi";
import type { SessionRow } from "./types";
import { remainLabel } from "./util";

type Notify = (message: string, kind?: ToastKind) => void;

interface RenewModalProps {
  open: boolean;
  /** Phiên cần gia hạn (null khi không có mục tiêu). */
  session: SessionRow | null;
  onClose: () => void;
  /** Gia hạn thành công — caller tải lại dữ liệu. */
  onDone: () => void;
  notify: Notify;
}

/** Modal Gia hạn — hỏi số phút cộng vào thời hạn hiện tại. */
export function RenewModal({ open, session, onClose, onDone, notify }: RenewModalProps) {
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);

  const num = Number(minutes);
  const invalid = minutes.trim() === "" || !Number.isFinite(num) || num <= 0;

  const submit = async () => {
    if (!session || invalid) return;
    const ttl = Math.max(1, Math.round(num * 60));
    setBusy(true);
    try {
      await sandboxApi.renew(session.session_id, ttl);
      onDone();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gia hạn thất bại", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && session !== null}
      title={`Gia hạn — ${session?.workspace_name ?? session?.workspace_id ?? ""}`}
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field
          label="Số phút gia hạn thêm"
          hint="Mặc định 60 phút — cộng vào thời hạn hiện tại của phiên."
        >
          <input
            className={`input${invalid ? " input-invalid" : ""}`}
            type="number"
            min={1}
            aria-invalid={invalid}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </Field>
        {invalid ? (
          <span className="sbx-field-error" style={{ marginTop: -6 }}>Số phút phải là số lớn hơn 0.</span>
        ) : null}
        <div className="sbx-toolbar">
          <span className="sbx-meta">Hiện tại: {remainLabel(session?.expires_at)}</span>
          <span className="spacer" />
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={() => void submit()}>
            Gia hạn
          </Button>
        </div>
      </div>
    </Modal>
  );
}
