/**
 * TransferTab.tsx — Tải lên / Tải xuống qua REST.
 * Upload đi đúng luồng /upload của gateway: POST /upload (cấp token) →
 * PUT /upload/{token}?chunk=N (raw body, 4MB/phần) → POST /upload/{token}/complete.
 * File ≥ ngưỡng inline (~3MB) bắt buộc đi đường này; file nhỏ cũng dùng được.
 * Download: dán download_url từ kết quả tool file_read, hoặc chọn workspace + path.
 */

import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { post, putRaw } from "@/lib/api";
import { formatBytes } from "@/lib/format";

import type { UploadCompleteResponse, UploadInitResponse } from "./types";
import { useWorkspaces } from "./useWorkspaces";

export function TransferTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <UploadCard />
      <DownloadCard />
    </div>
  );
}

/* ------------------------------------------------------------------ upload */

function UploadCard() {
  const { workspaces, loading, error, reload } = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadCompleteResponse | null>(null);

  // Tự chọn workspace đầu tiên khi vừa nạp.
  useEffect(() => {
    setWorkspaceId((prev) => (prev === "" && workspaces.length > 0 ? workspaces[0]!.id : prev));
  }, [workspaces]);

  function pickFile(next: File | null) {
    setFile(next);
    setResult(null);
    setUploadError(null);
    // Đường đích mặc định = tên file gốc.
    if (next !== null && targetPath.trim() === "") setTargetPath(next.name);
  }

  async function handleUpload() {
    if (file === null) {
      setUploadError("Chưa chọn file.");
      return;
    }
    const path = targetPath.trim();
    if (path === "") {
      setUploadError("Chưa nhập đường đích trong workspace.");
      return;
    }
    setBusy(true);
    setUploadError(null);
    setResult(null);
    setProgress(null);
    try {
      // Bước 1: khai báo phiên upload → cấp token + kích thước chunk.
      const init = await post<UploadInitResponse>("/upload", {
        workspace_id: workspaceId,
        path,
        size: file.size,
      });
      const chunkSize = init.chunk_size > 0 ? init.chunk_size : 4 * 1024 * 1024;
      const total = Math.max(1, Math.ceil(file.size / chunkSize));
      // Bước 2: PUT từng chunk (raw bytes, kèm ?chunk=N).
      for (let index = 0; index < total; index += 1) {
        const start = index * chunkSize;
        const slice = file.slice(start, Math.min(start + chunkSize, file.size));
        await putRaw(`${init.upload_url}?chunk=${index}`, slice);
        setProgress({ done: index + 1, total });
      }
      // Bước 3: ghép + hash + ghi vào VFS/blob.
      const done = await post<UploadCompleteResponse>(`${init.upload_url}/complete`);
      setResult(done);
      reload(); // dung lượng workspace vừa đổi — nạp lại danh sách
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card title="Tải lên workspace">
        <div className="empty-state">
          <Spinner />
        </div>
      </Card>
    );
  }

  if (error !== null) {
    return (
      <Card title="Tải lên workspace">
        <div className="ov-alert" role="alert">
          <strong>Không tải được danh sách workspace</strong>
          <span>{error}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Tải lên workspace">
      {workspaces.length === 0 ? (
        <EmptyState title="Chưa có workspace" description="Hãy tạo workspace ở tab Tổng quan trước khi tải lên." />
      ) : (
        <form
          className="ov-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleUpload();
          }}
        >
          <div className="ov-form-desc">
            Luồng REST: <code>POST /upload</code> → <code>PUT /upload/&#123;token&#125;?chunk=N</code> (raw body) →{" "}
            <code>POST /upload/&#123;token&#125;/complete</code>. File ≥ ngưỡng inline (~3MB) tự đi đường theo phần,
            chunk {formatBytes(4 * 1024 * 1024)}/phần.
          </div>

          <Field label="Workspace đích">
            <select
              className="select"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setResult(null);
              }}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name ? `${ws.name} — ${ws.id}` : ws.id}
                </option>
              ))}
            </select>
          </Field>

          <Field label="File" hint="Kích thước khai báo trước để server kiểm tra hạn mức.">
            <input
              className="input"
              type="file"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </Field>

          <Field label="Đường đích trong workspace" hint="Ví dụ: data/bao-cao.pdf — tự điền theo tên file nếu bỏ trống.">
            <input
              className="input mono"
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              disabled={busy}
            />
          </Field>

          {file !== null ? (
            <div className="ov-form-desc">
              Đã chọn: <strong>{file.name}</strong> — {formatBytes(file.size)}
            </div>
          ) : null}

          {progress !== null ? (
            <div className="ov-progress">
              <div className="ov-progress-bar" aria-hidden="true">
                <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
              <span>
                Đã gửi {progress.done}/{progress.total} phần
              </span>
            </div>
          ) : null}

          {uploadError !== null ? (
            <div className="ov-alert" role="alert">
              <strong>Tải lên thất bại</strong>
              <span>{uploadError}</span>
            </div>
          ) : null}

          {result !== null ? <UploadResult result={result} /> : null}

          <div>
            <Button variant="primary" type="submit" loading={busy}>
              Tải lên theo phần
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Kết quả complete: sha256 + nơi lưu + revision. */
function UploadResult({ result }: { result: UploadCompleteResponse }) {
  return (
    <div className="ov-result">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge tone="green">OK</Badge>
        <span className="ov-form-desc mono">{result.path}</span>
        <span className="ov-form-desc">{formatBytes(result.size)}</span>
      </div>
      <pre className="ov-pre">
        {`path     : ${result.path}
sha256   : ${result.sha256}
size     : ${result.size} B
storage  : ${result.storage}
rev      : ${result.rev ?? "—"}`}
      </pre>
    </div>
  );
}

/* ---------------------------------------------------------------- download */

function DownloadCard() {
  const { workspaces, loading, error } = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState("");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Tự chọn workspace đầu tiên khi vừa nạp.
  useEffect(() => {
    setWorkspaceId((prev) => (prev === "" && workspaces.length > 0 ? workspaces[0]!.id : prev));
  }, [workspaces]);

  /** Gửi file về máy qua fetch blob (dùng được cho cả đường /download lẫn URL dán vào). */
  async function handleDownload() {
    setBusy(true);
    setDownloadError(null);
    setDone(null);
    try {
      const pasted = url.trim();
      const target = pasted !== "" ? pasted : `/download/${encodeURIComponent(workspaceId)}?path=${encodeURIComponent(path.trim())}`;
      if (pasted === "" && path.trim() === "") {
        setDownloadError("Nhập đường dẫn file hoặc dán download_url từ kết quả tool file_read.");
        return;
      }
      const response = await fetch(target, { headers: { Accept: "application/octet-stream" } });
      if (!response.ok) {
        setDownloadError(`Tải xuống thất bại (HTTP ${response.status}).`);
        return;
      }
      const blob = await response.blob();
      // Tên file: từ path query, nếu không có thì từ đuôi URL.
      let filename = "file";
      try {
        const parsed = new URL(target, window.location.origin);
        const queryPath = parsed.searchParams.get("path");
        if (queryPath) filename = queryPath.split("/").pop() || "file";
        else filename = parsed.pathname.split("/").pop() || "file";
      } catch {
        filename = "file";
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setDone(`Đã tải ${filename} (${formatBytes(blob.size)}) về máy.`);
    } catch (err: unknown) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || error !== null) {
    return (
      <Card title="Tải xuống">
        {error !== null ? (
          <div className="ov-alert" role="alert">
            <strong>Không tải được danh sách workspace</strong>
            <span>{error}</span>
          </div>
        ) : (
          <div className="empty-state">
            <Spinner />
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title="Tải xuống">
      <form
        className="ov-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleDownload();
        }}
      >
        <div className="ov-form-desc">
          Cách 1 — dán <code>download_url</code> lấy từ kết quả tool <code>file_read</code> (file ≥ ngưỡng inline). Cách
          2 — chọn workspace + đường dẫn, hệ thống gọi <code>GET /download/&#123;workspace_id&#125;?path=…</code>.
        </div>

        <Field label="download_url (tùy chọn — ưu tiên nếu điền)">
          <input
            className="input mono"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/download/{workspace_id}?path=docs/bao-cao.pdf"
            disabled={busy}
          />
        </Field>

        <Field label="Workspace (cách 2)">
          <select
            className="select"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={busy}
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name ? `${ws.name} — ${ws.id}` : ws.id}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Đường dẫn file (cách 2)">
          <input
            className="input mono"
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="docs/bao-cao.pdf"
            disabled={busy}
          />
        </Field>

        {downloadError !== null ? (
          <div className="ov-alert" role="alert">
            <strong>Tải xuống thất bại</strong>
            <span>{downloadError}</span>
          </div>
        ) : null}

        {done !== null ? (
          <div className="ov-form-desc" role="status">
            {done}
          </div>
        ) : null}

        <div>
          <Button variant="primary" type="submit" loading={busy}>
            Tải về máy
          </Button>
        </div>
      </form>
    </Card>
  );
}
