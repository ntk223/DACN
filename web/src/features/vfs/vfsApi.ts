/**
 * vfsApi.ts — bọc các endpoint /admin/api/* cho feature VFS.
 * Dùng lại get/post/del của lib/api.ts (ApiError chuẩn); riêng PUT JSON
 * lib chỉ có putRaw (Blob) nên tự viết putJson cục bộ, lỗi vẫn chuẩn hóa về ApiError.
 */

import { ApiError, del, get, post } from "@/lib/api";
import type { ApiErrorShape } from "@/lib/api";
import type {
  EditResult,
  FileDetail,
  FuzzyAlgoResult,
  MoveResult,
  Overview,
  PathAlgoResult,
  UploadInitResult,
  WorkspaceDetail,
  WriteResult,
} from "./types";

const BASE = "/admin/api";

/** Chuẩn hóa payload lỗi cục bộ cho putJson (bản rút gọn của normalizeError ở lib). */
function payloadError(payload: unknown, status: number): ApiErrorShape {
  const body = (payload ?? {}) as {
    error?: { code?: unknown; message?: unknown };
    detail?: unknown;
  };
  if (body.error && typeof body.error === "object") {
    const e = body.error;
    return {
      code: typeof e.code === "string" ? e.code : "unknown_error",
      message:
        typeof e.message === "string" && e.message.length > 0
          ? e.message
          : `Lỗi máy chủ (HTTP ${status})`,
    };
  }
  if (typeof body.detail === "string" && body.detail.length > 0) {
    return { code: "http_error", message: body.detail };
  }
  return { code: "unknown_error", message: `Lỗi không xác định (HTTP ${status})` };
}

/** PUT body JSON — dùng cho ghi file (lib/api.ts chưa có put JSON). */
async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) throw new ApiError(payloadError(parsed, response.status), response.status);
  return parsed as T;
}

/** Thông điệp lỗi gọn để hiển thị toast. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function wsUrl(workspaceId: string, suffix = ""): string {
  return `${BASE}/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;
}

export const vfsApi = {
  overview: (): Promise<Overview> => get<Overview>(`${BASE}/overview`),

  workspace: (workspaceId: string): Promise<WorkspaceDetail> =>
    get<WorkspaceDetail>(wsUrl(workspaceId)),

  file: (workspaceId: string, path: string): Promise<FileDetail> =>
    get<FileDetail>(wsUrl(workspaceId, "/file"), { query: { path } }),

  createWorkspace: (name: string, conflictPolicy: string): Promise<{ workspace_id: string }> =>
    post<{ workspace_id: string }>(`${BASE}/workspaces`, { name, conflict_policy: conflictPolicy }),

  write: (
    workspaceId: string,
    path: string,
    content: string,
    encoding: "utf-8" | "base64" = "utf-8",
  ): Promise<WriteResult> =>
    putJson<WriteResult>(wsUrl(workspaceId, "/file"), { path, content, encoding }),

  edit: (
    workspaceId: string,
    body: { path: string; old_text: string; new_text: string; dry_run: boolean },
  ): Promise<EditResult> => post<EditResult>(wsUrl(workspaceId, "/edit"), body),

  remove: (workspaceId: string, path: string): Promise<WriteResult> =>
    del<WriteResult>(wsUrl(workspaceId, `/file?path=${encodeURIComponent(path)}`)),

  move: (workspaceId: string, src: string, dst: string): Promise<MoveResult> =>
    post<MoveResult>(wsUrl(workspaceId, "/move"), { src, dst }),

  restore: (workspaceId: string, path: string, revisionId: number): Promise<WriteResult> =>
    post<WriteResult>(wsUrl(workspaceId, "/restore"), { path, revision_id: revisionId }),

  algoPath: (path: string): Promise<PathAlgoResult> =>
    post<PathAlgoResult>(`${BASE}/algo/path`, { path }),

  algoFuzzy: (body: {
    content: string;
    old_text: string;
    new_text: string;
  }): Promise<FuzzyAlgoResult> => post<FuzzyAlgoResult>(`${BASE}/algo/fuzzy`, body),

  uploadInit: (
    workspaceId: string,
    path: string,
    size: number,
    sha256: string,
  ): Promise<UploadInitResult> =>
    post<UploadInitResult>("/upload", { workspace_id: workspaceId, path, size, sha256 }),
};
