/**
 * StartModal.tsx — modal Bật sandbox (tách từ SandboxOpsPage, port từ bảng
 * Quản lý cũ): TTL phút + CPU + RAM, validation inline chặn gửi khi sai.
 */
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import type { ToastKind } from "@/components/Toast";
import { useState } from "react";
import { sandboxApi } from "./sandboxApi";
import type { SessionRow, StartResult } from "./types";
import { limitsLabel } from "./util";

type Notify = (message: string, kind?: ToastKind) => void;

interface StartModalProps {
  open: boolean;
  /** Phiên cần bật sandbox (null khi không có mục tiêu). */
  session: SessionRow | null;
  onClose: () => void;
  /** Bật thành công — caller chuyển chọn sang sandbox mới + tải lại. */
  onStarted: (result: StartResult) => void;
  notify: Notify;
}

/** Modal Bật sandbox — TTL/CPU/RAM + validation inline. */
export function StartModal({ open, session, onClose, onStarted, notify }: StartModalProps) {
  const [ttlMinutes, setTtlMinutes] = useState("60");
  const [cpu, setCpu] = useState("");
  const [memoryMb, setMemoryMb] = useState("");
  const [busy, setBusy] = useState(false);

  // Validation inline — chặn gửi khi giá trị không hợp lệ.
  const ttlNum = Number(ttlMinutes);
  const ttlInvalid = ttlMinutes.trim() === "" || !Number.isFinite(ttlNum) || ttlNum <= 0;
  const cpuNum = Number(cpu);
  const cpuInvalid = cpu.trim() !== "" && (!Number.isFinite(cpuNum) || cpuNum <= 0);
  const memNum = Number(memoryMb);
  const memInvalid = memoryMb.trim() !== "" && (!Number.isFinite(memNum) || memNum <= 0);
  const invalid = ttlInvalid || cpuInvalid || memInvalid;

  const submit = async () => {
    if (!session || invalid) return;
    const ttl = Math.max(1, Math.round(ttlNum * 60));
    setBusy(true);
    try {
      const result = await sandboxApi.start(session.session_id, {
        ttl_seconds: ttl,
        cpu: cpu.trim() !== "" && Number.isFinite(cpuNum) && cpuNum > 0 ? cpuNum : null,
        memory: memoryMb.trim() !== "" && Number.isFinite(memNum) && memNum > 0 ? memNum : null,
      });
      onStarted(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Bật sandbox thất bại", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && session !== null}
      title={`Bật sandbox — ${session?.workspace_name ?? session?.workspace_id ?? ""}`}
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field
          label="TTL — thời gian sống (phút)"
          hint="Mặc định 60 phút. Hết hạn sandbox tự dừng sau khoảng này."
        >
          <input
            className={`input${ttlInvalid ? " input-invalid" : ""}`}
            type="number"
            min={1}
            aria-invalid={ttlInvalid}
            value={ttlMinutes}
            onChange={(event) => setTtlMinutes(event.target.value)}
          />
        </Field>
        {ttlInvalid ? (
          <span className="sbx-field-error" style={{ marginTop: -6 }}>TTL phải là số lớn hơn 0.</span>
        ) : null}
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="CPU (core)" hint="Mặc định: không giới hạn.">
            <input
              className={`input${cpuInvalid ? " input-invalid" : ""}`}
              type="number"
              step="0.5"
              min="0"
              placeholder="không giới hạn"
              aria-invalid={cpuInvalid}
              value={cpu}
              onChange={(event) => setCpu(event.target.value)}
            />
          </Field>
          <Field label="RAM (MB)" hint="Mặc định: không giới hạn.">
            <input
              className={`input${memInvalid ? " input-invalid" : ""}`}
              type="number"
              step="128"
              min="0"
              placeholder="không giới hạn"
              aria-invalid={memInvalid}
              value={memoryMb}
              onChange={(event) => setMemoryMb(event.target.value)}
            />
          </Field>
        </div>
        {cpuInvalid || memInvalid ? (
          <span className="sbx-field-error">CPU / RAM phải là số lớn hơn 0, hoặc bỏ trống.</span>
        ) : null}
        <div className="sbx-toolbar">
          <span className="sbx-meta">
            Tổng tài nguyên: {limitsLabel(Number(cpu) || null, Number(memoryMb) || null)}
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={() => void submit()}>
            Bật sandbox
          </Button>
        </div>
      </div>
    </Modal>
  );
}
