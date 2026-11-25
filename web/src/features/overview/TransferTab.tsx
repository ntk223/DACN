/**
 * TransferTab.tsx — Tải lên / Tải xuống qua REST.
 * Upload đi đúng luồng /upload của gateway: POST /upload (cấp token) →
 * PUT /upload/{token}?chunk=N (raw body, 4MB/phần) → POST /upload/{token}/complete.
 * File ≥ ngưỡng inline (~3MB) bắt buộc đi đường này; file nhỏ cũng dùng được.
 * Download: dán download_url từ kết quả tool file_read, hoặc chọn workspace + path.
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { post, putRaw } from "@/lib/api";
import { formatBytes } from "@/lib/format";

import { IconCheckCircle, IconErrorCircle, IconUpload } from "./icons";
import { OvLoading, OvState } from "./states";
import type { UploadCompleteResponse, UploadInitResponse } from "./types";
import { useWorkspaces } from "./useWorkspaces";

export function TransferTab() {
  return (
    <div className="ov-sections">
      <UploadCard />
      <DownloadCard />
    </div>
  );
}

/* ------------------------------------------------------------------ upload */

interface UploadProgress {
  done: number;
  total: number;
  /** Số byte đã gửi tính từ các chunk hoàn tất (không vượt quá kích thước file). */
  sentBytes: number;
}

function UploadCard() {
  const { workspaces, loading, error, reload } = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadCompleteResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setProgress({
          done: index + 1,
          total,
          sentBytes: Math.min((index + 1) * chunkSize, file.size),
        });
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
        <OvLoading title="Đang tải danh sách workspace…" description="Chọn workspace đích cho file upload." />
      </Card>
    );
  }

  if (error !== null) {
    return (
      <Card title="Tải lên workspace">
        <div className="ov-alert" role="alert">
          <IconErrorCircle />
          <div className="ov-alert-body">
            <strong>Không tải được danh sách workspace</strong>
            <span>{error}</span>
          </div>
        </div>
      </Card>
    );
  }

  const percent = progress !== null && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card title="Tải lên workspace">
      {workspaces.length === 0 ? (
        <OvState
          title="Chưa có workspace"
          description="Hãy tạo workspace ở tab Tổng quan trước khi tải lên."
        />
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

          {/* Vùng kéo-thả / chọn file — ẩn input thật, zone là nút bấm ≥ 48px */}
          <Field label="File" hint="Kích thước khai báo trước để server kiểm tra hạn mức.">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <button
              type="button"
              className={dragging ? "ov-dropzone is-drag" : "ov-dropzone"}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped !== undefined) pickFile(dropped);
              }}
            >
              <IconUpload />
              <span>
                <span className="ov-dropzone-title">
                  {file !== null ? file.name : "Kéo thả file vào đây, hoặc bấm để chọn file"}
                </span>
                <span className="ov-dropzone-hint">
                  {file !== null ? `${formatBytes(file.size)} — bấm để chọn file khác` : "Mọi kích thước — file lớn tự chia phần 4MB"}
                </span>
              </span>
            </button>
          </Field>

          <Field
            label="Đường đích trong workspace"
            hint="Ví dụ: data/bao-cao.pdf — tự điền theo tên file nếu bỏ trống."
          >
            <input
              className="input mono"
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              disabled={busy}
            />
          </Field>

          {progress !== null ? (
            <div className="ov-progress" role="status">
              <div className="ov-progress-meta">
                <span>Đang tải lên…</span>
                <span>
                  {percent}% · {formatBytes(progress.sentBytes)} / {file !== null ? formatBytes(file.size) : "—"} (
                  {progress.done}/{progress.total} phần)
                </span>
              </div>
              <div
                className="ov-progress-bar"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${percent}%` }} />
              </div>
            </div>
          ) : null}

          {uploadError !== null ? (
            <div className="ov-alert" role="alert">
              <IconErrorCircle />
              <div className="ov-alert-body">
                <strong>Tải lên thất bại</strong>
                <span>{uploadError}</span>
              </div>
            </div>
          ) : null}

          {result !== null ? <UploadResult result={result} /> : null}

          <div className="ov-form-footer">
            <Button variant="primary" type="submit" loading={busy}>
              Tải lên theo phần
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Kết quả complete: thông báo thành công (xanh) + sha256 + nơi lưu + revision. */
function UploadResult({ result }: { result: UploadCompleteResponse }) {
  return (
    <div className="ov-result">
      <div className="ov-success" role="status">
        <IconCheckCircle />
        <div className="ov-alert-body">
          <strong>Tải lên thành công</strong>
          <span>
            {result.path} — {formatBytes(result.size)} · lưu tại {result.storage}
          </span>
        </div>
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
            <IconErrorCircle />
            <div className="ov-alert-body">
              <strong>Không tải được danh sách workspace</strong>
              <span>{error}</span>
            </div>
          </div>
        ) : (
          <OvLoading title="Đang tải danh sách workspace…" description="Chọn nguồn file để tải về máy." />
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
            <IconErrorCircle />
            <div className="ov-alert-body">
              <strong>Tải xuống thất bại</strong>
              <span>{downloadError}</span>
            </div>
          </div>
        ) : null}

        {done !== null ? (
          <div className="ov-success" role="status">
            <IconCheckCircle />
            <div className="ov-alert-body">
              <span>{done}</span>
            </div>
          </div>
        ) : null}

        <div className="ov-form-footer">
          <Button variant="primary" type="submit" loading={busy}>
            Tải về máy
          </Button>
        </div>
      </form>
    </Card>
  );
}
