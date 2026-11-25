import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { formatBytes, formatTime, truncPath } from "@/lib/format";
import type { ToastKind } from "./Toast";
import { FuzzyEditModal } from "./FuzzyEditModal";
import type { FileDetail } from "./types";

interface FileEditorProps {
  wsId: string | null;
  file: FileDetail | null;
  isNew: boolean;
  dirty: boolean;
  busy: boolean;
  newPath: string;
  content: string;
  onNewPathChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onMove: () => void;
  onDelete: () => void;
  onToast: (message: string, kind: ToastKind) => void;
  /** Refresh sau khi fuzzy edit áp dụng (giữ nguyên file đang mở). */
  onMutated: () => void;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Uint8Array → base64 (dùng cho image preview). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

/** 512 byte đầu của file nhị phân → bảng hex + ASCII (như trang cũ). */
function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  const limit = Math.min(bytes.length, 512);
  for (let i = 0; i < limit; i += 16) {
    const row = bytes.slice(i, i + 16);
    const hex = Array.from(row)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47, " ");
    const ascii = Array.from(row)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${i.toString(16).padStart(6, "0")}  ${hex}  ${ascii}`);
  }
  if (bytes.length > 512) lines.push(`… còn ${bytes.length - 512} byte`);
  return lines.join("\n");
}

function decodeBase64(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fileMetaRows(file: FileDetail): Array<{ key: string; value: ReactNode }> {
  const synced = file.synced_sha256
    ? `${file.synced_sha256.slice(0, 10)}${file.synced_sha256 === file.sha256 ? " (khớp)" : " (lệch)"}`
    : "chưa đồng bộ";
  return [
    { key: "size", value: `${formatBytes(file.size)} (${file.size} B)` },
    { key: "sha256", value: file.sha256 },
    { key: "rev", value: file.rev },
    {
      key: "lưu trữ",
      value: (
        <>
          <Badge tone={file.storage_class === "blob" ? "default" : "gray"}>{file.storage_class}</Badge>{" "}
          {file.ignored ? <Badge tone="yellow">thuộc vùng không lưu (dữ liệu cũ)</Badge> : null}
        </>
      ),
    },
    { key: "blob_ref", value: file.blob_ref ?? "—" },
    { key: "synced", value: synced },
    { key: "mtime", value: file.mtime ? formatTime(file.mtime) : "—" },
    { key: "nhị phân", value: file.is_binary ? "có" : "không" },
  ];
}

/**
 * Tab "Nội dung file": meta + trình sửa (Ctrl+S lưu, Tab = 4 spaces),
 * xem nhị phân (ảnh + hex), hành động lưu/sửa khớp mờ/đổi tên/tải về/xóa.
 */
export function FileEditor({
  wsId,
  file,
  isNew,
  dirty,
  busy,
  newPath,
  content,
  onNewPathChange,
  onContentChange,
  onSave,
  onMove,
  onDelete,
  onToast,
  onMutated,
}: FileEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [fuzzyOpen, setFuzzyOpen] = useState(false);
  const editable = isNew || (file !== null && file.encoding === "utf-8");


  // Ctrl+S / Cmd+S lưu — đăng ký toàn cục khi tab này đang mở.
  useEffect(() => {
    if (!editable) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, onSave]);

  if (wsId === null || (file === null && !isNew)) {
    return (
      <EmptyState
        title="Chưa chọn file"
        description={
          <>
            Chọn một file trong cây bên trái, hoặc bấm <b>+ File</b> (phím <span className="kbd">N</span>) để tạo mới.
          </>
        }
      />
    );
  }

  // Tab trong textarea: chèn 4 dấu cách, giữ vị trí con trỏ.
  const handleTab = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const editor = event.currentTarget;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("    ", start, end, "end");
    onContentChange(editor.value);
  };

  const openFuzzy = () => {
    const editor = editorRef.current;
    const hasSelection = editor !== null && editor.selectionEnd > editor.selectionStart;
    if (editor !== null && hasSelection) {
      // Chốt selection hiện tại vào state trước khi modal lấy focus.
      onContentChange(editor.value);
    }
    setFuzzyOpen(true);
  };

  const fuzzyInitial = (() => {
    const editor = editorRef.current;
    if (editor !== null && editor.selectionEnd > editor.selectionStart) {
      return editor.value.slice(editor.selectionStart, editor.selectionEnd);
    }
    return file?.content ?? "";
  })();

  const fuzzyDisabled = !editable || isNew || file === null || file.encoding !== "utf-8";

  return (
    <div>
      <div className="vfs-row" style={{ marginBottom: 10 }}>
        <Button variant="primary" size="sm" loading={busy} disabled={!editable} onClick={onSave} title="Ctrl+S">
          Lưu{dirty ? " •" : ""}
        </Button>
        <Button size="sm" disabled={fuzzyDisabled} onClick={openFuzzy}>
          Sửa khớp mờ
        </Button>
        <Button size="sm" disabled={isNew || file === null} onClick={onMove}>
          Đổi tên
        </Button>
        {file !== null && !isNew ? (
          <a className="btn btn-sm" href={file.download_url} download={file.path.split("/").pop()}>
            Tải về
          </a>
        ) : null}
        <Button variant="danger" size="sm" disabled={isNew || file === null} onClick={onDelete}>
          Xóa
        </Button>
      </div>

      {isNew ? (
        <div className="vfs-row" style={{ marginBottom: 10 }}>
          <input
            className="input vfs-grow mono"
            value={newPath}
            placeholder="đường dẫn, vd src/main.py"
            onChange={(e) => onNewPathChange(e.target.value)}
            autoFocus
          />
        </div>
      ) : null}

      {file !== null && !isNew ? (
        <dl className="vfs-kv" style={{ marginBottom: 10 }}>
          {fileMetaRows(file).map((row) => (
            <div key={row.key} className="vfs-kv-pair">
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {editable ? (
        <textarea
          ref={editorRef}
          className="textarea vfs-editor"
          value={content}
          spellCheck={false}
          onChange={(e) => onContentChange(e.target.value)}
          onKeyDown={handleTab}
          placeholder={isNew ? "Nội dung file mới…" : undefined}
        />
      ) : file !== null && file.encoding === "none" ? (
        <EmptyState
          title={`File ${formatBytes(file.size)} vượt ngưỡng inline`}
          description={<>Dùng nút “Tải về” ở trên để lấy nội dung.</>}
        />
      ) : file !== null ? (
        (() => {
          const bytes = decodeBase64(file.content ?? "");
          const ext = (file.path.split(".").pop() ?? "").toLowerCase();
          const mime = MIME_BY_EXT[ext];
          return (
            <>
              {mime !== undefined ? (
                <img
                  className="vfs-preview-img"
                  alt={file.path}
                  src={`data:${mime};base64,${toBase64(bytes)}`}
                  style={{ marginBottom: 10 }}
                />
              ) : null}
              <pre className="vfs-hex">{hexDump(bytes)}</pre>
            </>
          );
        })()
      ) : null}

      {fuzzyOpen && wsId !== null && file !== null ? (
        <FuzzyEditModal
          open={fuzzyOpen}
          wsId={wsId}
          path={file.path}
          initialText={fuzzyInitial}
          fromSelection={
            editorRef.current !== null && editorRef.current.selectionEnd > editorRef.current.selectionStart
          }
          onClose={() => setFuzzyOpen(false)}
          onApplied={onMutated}
          onToast={onToast}
        />
      ) : null}

      {!isNew && file !== null ? (
        <div className="vfs-dim vfs-small" style={{ marginTop: 6 }} title={file.path}>
          {truncPath(file.path, 80)}
        </div>
      ) : null}
    </div>
  );
}
