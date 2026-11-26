/**
 * upload.ts — upload 1 file vào workspace: inline (≤ ngưỡng) hoặc theo phần
 * (POST /upload → PUT chunk kèm X-Chunk-Sha256 → POST /upload/{token}/complete).
 * Port từ trang vfs.html cũ; port lib/api.ts không dùng vì chunk PUT cần header riêng.
 */

import { post } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { ToastKind } from "@/components/Toast";
import { vfsApi } from "./vfsApi";
import type { UploadCompleteResult } from "./types";

/** SHA-256 hex của một buffer (dùng WebCrypto — browser an toàn origin https/localhost). */
export async function sha256Hex(buffer: ArrayBuffer | ArrayBufferView): Promise<string> {
  // Copy sang Uint8Array<ArrayBuffer> mới để khớp kiểu BufferSource (tránh SharedArrayBuffer).
  const source =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer, 0, buffer.byteLength)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Uint8Array → base64 (mã hóa theo khối để tránh tràn stack call apply). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

/**
 * Upload 1 file theo đường dẫn đích đã chọn. Trả về path đã ghi.
 * `log` dùng để báo tiến trình (toast warn khi đi đường chunked).
 */
export async function uploadOne(
  workspaceId: string,
  path: string,
  file: File,
  inlineMaxBytes: number,
  log: (message: string, kind: ToastKind) => void,
): Promise<string> {
  const buffer = await file.arrayBuffer();

  // Đường inline: nhúng base64 vào PUT /file như file text thường.
  if (buffer.byteLength <= inlineMaxBytes) {
    const result = await vfsApi.write(workspaceId, path, toBase64(new Uint8Array(buffer)), "base64");
    log(`${result.path}: ${result.noop ? "no-op" : `rev ${result.rev}`} (inline)`, "success");
    return result.path;
  }

  // Đường chunked cho file lớn.
  log(`${file.name}: ${formatBytes(buffer.byteLength)} vượt ngưỡng inline → upload theo phần…`, "warn");
  const init = await vfsApi.uploadInit(workspaceId, path, buffer.byteLength, await sha256Hex(buffer));
  const chunkSize = init.chunk_size;
  for (let offset = 0, index = 0; offset < buffer.byteLength; offset += chunkSize, index++) {
    const part = buffer.slice(offset, offset + chunkSize);
    const response = await fetch(`${init.upload_url}?chunk=${index}`, {
      method: "PUT",
      body: part,
      headers: { "X-Chunk-Sha256": await sha256Hex(part) },
    });
    if (!response.ok) throw new Error(`chunk ${index}: HTTP ${response.status}`);
  }
  const done = await post<UploadCompleteResult>(`${init.upload_url}/complete`);
  log(`${done.path}: rev ${done.rev ?? "?"} · storage=${done.storage}`, "success");
  return done.path;
}
