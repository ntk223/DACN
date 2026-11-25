/**
 * FileBrowser.tsx — duyệt / đọc file trong /workspace của sandbox
 * (GET /sandboxes/{id}/file). Nội dung hiển thị trong pre mono.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { formatBytes } from "@/lib/format";
import { sandboxApi } from "./sandboxApi";
import type { FileContent, WorkspaceListing } from "./types";

interface FileBrowserProps {
  sandboxId: string;
  listing: WorkspaceListing | undefined;
  /** Thay đổi khi danh sách file được tải lại (auto-refresh) — reset lựa chọn nếu file biến mất. */
  notify: (message: string, kind?: "ok" | "err" | "warn") => void;
}

export function FileBrowser({ sandboxId, listing, notify }: FileBrowserProps) {
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);

  // Đổi sandbox → đóng khung xem file.
  useEffect(() => {
    setActivePath(null);
    setContent(null);
  }, [sandboxId]);

  if (!listing) {
    return (
      <Card title="File /workspace">
        <EmptyState title="Provider không cung cấp danh sách file" />
      </Card>
    );
  }

  if (listing.error) {
    return (
      <Card title="File /workspace">
        <EmptyState title="Không liệt kê được /workspace">
          {listing.error.message ?? "Lỗi không xác định"}
        </EmptyState>
      </Card>
    );
  }

  const files = listing.files ?? [];

  const openFile = async (path: string) => {
    setActivePath(path);
    setLoading(true);
    try {
      setContent(await sandboxApi.readFile(sandboxId, path));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Đọc file thất bại", "err");
      setContent(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="File /workspace"
      actions={
        <span className="sbx-meta">
          {listing.total ?? files.length} file{listing.truncated ? " (danh sách bị cắt)" : ""}
        </span>
      }
    >
      {files.length === 0 ? (
        <EmptyState title="/workspace trống" />
      ) : (
        <>
          <div className="sbx-files">
            {files.map((file) => (
              <div
                key={file.path}
                className={`sbx-file${file.path === activePath ? " sbx-file-active" : ""}`}
                onClick={() => void openFile(file.path)}
              >
                <span className="sbx-file-path">{file.path}</span>
                <span className="sbx-meta">{file.size != null ? formatBytes(file.size) : "—"}</span>
              </div>
            ))}
          </div>

          {content !== null ? (
            <div style={{ marginTop: 12 }}>
              <div className="sbx-badges" style={{ marginBottom: 6 }}>
                <span className="sbx-mono" style={{ fontWeight: 600 }}>{content.path}</span>
                {content.size != null ? <Badge>{formatBytes(content.size)}</Badge> : null}
                {content.truncated ? <Badge tone="yellow">đã cắt</Badge> : null}
                {content.encoding === "base64" ? <Badge tone="yellow">nhị phân (base64)</Badge> : null}
                {loading ? <Badge>đang tải…</Badge> : null}
              </div>
              <pre className="sbx-pre">{content.content}</pre>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
