import { useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { formatTime } from "@/lib/format";
import { ConfirmDialog } from "./ConfirmDialog";
import { LineDiffView } from "./LineDiffView";
import type { ToastKind } from "./Toast";
import { errorMessage, vfsApi } from "./vfsApi";
import type { FileDetail, Revision } from "./types";

interface HistoryPanelProps {
  wsId: string | null;
  file: FileDetail | null;
  isNew: boolean;
  onToast: (message: string, kind: ToastKind) => void;
  /** Refresh workspace + file sau khi khôi phục. */
  onRefresh: () => void;
}

/** Chọn cách trình bày diff của một bản lịch sử (port showRevision của trang cũ). */
function revisionDiff(file: FileDetail, rev: Revision, prev: Revision | undefined) {
  if (!rev.restorable) {
    return { title: rev.patch, before: "", after: "" };
  }
  if (prev !== undefined && prev.restorable) {
    return { title: `Thay đổi của #${rev.id} (so với #${prev.id})`, before: prev.patch, after: rev.patch };
  }
  if (file.encoding === "utf-8") {
    return {
      title: `#${rev.id} → bản hiện tại (bản trước #${rev.id} đã bị cắt khỏi lịch sử)`,
      before: rev.patch,
      after: file.content ?? "",
    };
  }
  return { title: `#${rev.id}`, before: "", after: rev.patch };
}

/** Tab "Lịch sử": danh sách revision của file, xem diff từng bản, khôi phục (có xác nhận). */
export function HistoryPanel({ wsId, file, isNew, onToast, onRefresh }: HistoryPanelProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmRev, setConfirmRev] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);

  const revisions = file !== null && !isNew ? file.revisions : [];

  if (file === null || isNew) {
    return <EmptyState title="Chưa chọn file" description="Chọn một file trong cây để xem lịch sử." />;
  }
  if (revisions.length === 0) {
    return (
      <EmptyState
        title="Chưa có lịch sử"
        description="File chưa được sửa lần nào (mỗi lần ghi tạo một bản lưu trong lịch sử)."
      />
    );
  }

  const selected = revisions.find((r) => r.id === selectedId) ?? null;
  const selectedIndex = selected !== null ? revisions.indexOf(selected) : -1;
  const next = selectedIndex >= 0 ? revisions[selectedIndex + 1] : undefined;
  const diff = selected !== null ? revisionDiff(file, selected, next) : null;

  const restore = async () => {
    if (selected === null || wsId === null) return;
    setBusy(true);
    try {
      const result = await vfsApi.restore(wsId, file.path, selected.id);
      onToast(result.noop ? "Nội dung trùng bản hiện tại" : `Đã khôi phục · rev ${result.rev}`, result.noop ? "warn" : "success");
      setConfirmRev(null);
      setSelectedId(null);
      onRefresh();
    } catch (error) {
      onToast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="vfs-dim vfs-small" style={{ marginBottom: 8 }}>
        {`Tối đa 20 bản mỗi file · bấm một bản để xem diff`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {revisions.map((rev, index) => (
          <div
            key={rev.id}
            className={`vfs-rev${rev.id === selectedId ? " active" : ""}`}
            onClick={() => setSelectedId(rev.id === selectedId ? null : rev.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSelectedId(rev.id === selectedId ? null : rev.id);
            }}
          >
            <span className="vfs-dim vfs-small">{`#${rev.id}`}</span>
            <span className="vfs-small vfs-grow">{formatTime(rev.created_at)}</span>
            <span className="vfs-dim vfs-small">{`${rev.before_sha.slice(0, 10)} → ${rev.after_sha.slice(0, 10)}`}</span>
            {rev.restorable === false ? <Badge tone="gray" title="Bản không lưu toàn văn (file lớn/nhị phân)">không lưu toàn văn</Badge> : null}
            {rev.after_sha === file.sha256 ? <Badge tone="green">hiện tại</Badge> : null}
            <span className="vfs-dim vfs-small" title="Vị trí trong lịch sử">
              {index === 0 ? "mới nhất" : ""}
            </span>
          </div>
        ))}
      </div>

      {selected !== null && diff !== null ? (
        <div style={{ marginTop: 10 }}>
          <div className="vfs-row">
            <span className="vfs-small vfs-grow vfs-dim">{diff.title}</span>
            <Button
              size="sm"
              variant="primary"
              disabled={selected.restorable === false || selected.after_sha === file.sha256}
              onClick={() => setConfirmRev(selected)}
            >
              Khôi phục bản này
            </Button>
          </div>
          <div style={{ marginTop: 8 }}>
            <LineDiffView before={diff.before} after={diff.after} maxHeight={320} />
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRev !== null}
        title="Khôi phục bản lịch sử"
        message={`Khôi phục nội dung bản #${confirmRev?.id ?? ""} cho '${file.path}'? Thao tác sẽ tạo một bản mới trong lịch sử.`}
        confirmLabel="Khôi phục"
        busy={busy}
        onConfirm={() => void restore()}
        onClose={() => (busy ? undefined : setConfirmRev(null))}
      />
    </div>
  );
}
