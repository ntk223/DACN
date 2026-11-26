/**
 * vfsApi.ts — bọc các endpoint /admin/api/* cho feature VFS.
 * Dùng lại get/post/putJson/del của lib/api.ts (ApiError chuẩn hóa thống nhất).
 */

import { ApiError, del, get, post, putJson } from "@/lib/api";
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
