import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatBytes } from "@/lib/format";
import type { ToastKind } from "@/components/Toast";
import { errorMessage } from "./vfsApi";
import { uploadOne } from "./upload";

interface UploadModalProps {
  open: boolean;
  wsId: string | null;
  files: File[];
  /** Thư mục đích khởi tạo (prefill từ file đang mở trong cây). */
  initialDir: string;
  inlineMaxBytes: number;
  onClose: () => void;
  /** Gọi khi mọi file đã xử lý xong — lastPath là path upload thành công cuối cùng. */
  onDone: (lastPath: string | null) => void;
  onToast: (message: string, kind: ToastKind) => void;
}

type UploadState = "pending" | "uploading" | "done" | "error";

interface UploadStatus {
  state: UploadState;
  message?: string;
}

const STATE_BADGE: Record<UploadState, { tone: "gray" | "default" | "green" | "red"; label: string }> = {
  pending: { tone: "gray", label: "chờ" },
  uploading: { tone: "default", label: "đang tải" },
  done: { tone: "green", label: "xong" },
  error: { tone: "red", label: "lỗi" },
};

/**
 * Modal upload: nhập thư mục đích (prefill thư mục hiện hành), list file đã chọn
 * với đường dẫn đích sửa được từng file, tiến trình từng file (thay cho hộp prompt cũ).
 */
export function UploadModal({
  open,
  wsId,
  files,
  initialDir,
  inlineMaxBytes,
  onClose,
  onDone,
  onToast,
}: UploadModalProps) {
  const [dir, setDir] = useState(initialDir);
  const [targets, setTargets] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<UploadStatus[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  // Mỗi lần mở modal: khởi tạo thư mục đích + trạng thái "chờ" cho từng file.
  useEffect(() => {
    if (open) {
      setDir(initialDir);
      setTargets(files.map((file) => initialDir + file.name));
      setStatuses(files.map(() => ({ state: "pending" as const })));
      setRunning(false);
      runningRef.current = false;
    }
  }, [open, files, initialDir]);

  const applyDir = (value: string) => {
    setDir(value);
    // Prefill lại toàn bộ đích theo thư mục mới (giữ nguyên tên file).
    setTargets(files.map((file) => value + file.name));
  };

  const setTarget = (index: number, value: string) => {
    setTargets((current) => current.map((t, i) => (i === index ? value : t)));
  };

  const setStatus = (index: number, status: UploadStatus) => {
    setStatuses((current) => current.map((s, i) => (i === index ? status : s)));
  };

  const start = async () => {
    if (wsId === null || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    let last: string | null = null;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file === undefined) continue;
      const target = (targets[i] ?? "").trim();
      if (target.length === 0) {
        setStatus(i, { state: "error", message: "Bỏ qua — đường dẫn đích trống" });
        continue;
      }
      setStatus(i, { state: "uploading" });
      try {
        last = await uploadOne(wsId, target, file, inlineMaxBytes, onToast);
        setStatus(i, { state: "done", message: `rev đã ghi · ${target}` });
      } catch (error) {
        const message = errorMessage(error);
        setStatus(i, { state: "error", message });
        onToast(`${file.name}: ${message}`, "error");
      }
    }
    runningRef.current = false;
    setRunning(false);
    onDone(last);
  };

  return (
    <Modal
      open={open}
      title={`Upload ${files.length} file`}
      onClose={running ? () => undefined : onClose}
      width={640}
    >
      <label className="vfs-dim vfs-small" htmlFor="vfs-upload-dir" style={{ display: "block", marginBottom: 4 }}>
        Thư mục đích (prefill theo file đang mở — để trống để lưu ở gốc workspace)
      </label>
      <input
        id="vfs-upload-dir"
        className="input mono"
        value={dir}
        disabled={running}
        placeholder="vd src/data/"
        onChange={(e) => applyDir(e.target.value)}
      />

      <div style={{ marginTop: 12 }}>
        {files.map((file, index) => {
          const status = statuses[index] ?? { state: "pending" as const };
          const badge = STATE_BADGE[status.state];
          return (
            <div key={`${file.name}:${index}`} className="vfs-upload-row">
              <span className="vfs-upload-name mono" title={file.name}>
                {file.name}
              </span>
              <span className="vfs-dim vfs-small" style={{ flexShrink: 0 }}>
                {formatBytes(file.size)}
              </span>
              <input
                className="input mono vfs-upload-target"
                value={targets[index] ?? ""}
                disabled={running}
                placeholder="đường dẫn đích"
                onChange={(e) => setTarget(index, e.target.value)}
              />
              <Badge tone={badge.tone} title={status.message}>
                {badge.label}
              </Badge>
            </div>
          );
        })}
      </div>

      <div className="vfs-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <Button size="sm" disabled={running} onClick={onClose}>
          Hủy
        </Button>
        <Button size="sm" variant="primary" loading={running} onClick={() => void start()}>
          Bắt đầu upload
        </Button>
      </div>
    </Modal>
  );
}
