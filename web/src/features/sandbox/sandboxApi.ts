/**
 * sandboxApi.ts — client cho REST quản lý sandbox (admin_sandbox_api.py).
 * Lệnh thường đi qua lib/api.ts (chuẩn hóa lỗi ApiError); exec là stream NDJSON
 * nên tự fetch + lib/ndjson.ts, hủy bằng AbortController.
 */
import { del, get, post } from "@/lib/api";
import { readNdjson } from "@/lib/ndjson";
import type {
  CompareResult,
  ExecBody,
  ExecEvent,
  FileContent,
  LogsResult,
  Overview,
  PolicyResult,
  SandboxDetail,
  SessionRow,
  StartResult,
  StateResult,
  SyncResult,
} from "./types";

const BASE = "/admin/api";

function seg(value: string): string {
  return encodeURIComponent(value);
}

export interface StartBody {
  ttl_seconds: number;
  cpu?: number | null;
  memory?: number | null;
}

export const sandboxApi = {
  overview: () => get<Overview>(`${BASE}/sandboxes`),

  detail: (sandboxId: string) => get<SandboxDetail>(`${BASE}/sandboxes/${seg(sandboxId)}`),

  logs: (sandboxId: string, tail: number) =>
    get<LogsResult>(`${BASE}/sandboxes/${seg(sandboxId)}/logs`, { query: { tail } }),

  readFile: (sandboxId: string, path: string) =>
    get<FileContent>(`${BASE}/sandboxes/${seg(sandboxId)}/file`, { query: { path } }),

  deleteOrphan: (sandboxId: string) => del(`${BASE}/sandboxes/${seg(sandboxId)}`),

  start: (sessionId: string, body: StartBody) =>
    post<StartResult>(`${BASE}/sessions/${seg(sessionId)}/start`, body),

  stop: (sessionId: string) => post<StateResult>(`${BASE}/sessions/${seg(sessionId)}/stop`),

  pause: (sessionId: string) => post<StateResult>(`${BASE}/sessions/${seg(sessionId)}/pause`),

  resume: (sessionId: string) => post<StateResult>(`${BASE}/sessions/${seg(sessionId)}/resume`),

  renew: (sessionId: string, ttlSeconds: number) =>
    post<StateResult>(`${BASE}/sessions/${seg(sessionId)}/renew`, { ttl_seconds: ttlSeconds }),

  sync: (sessionId: string, full: boolean) =>
    post<SyncResult>(`${BASE}/sessions/${seg(sessionId)}/sync`, { full }),

  compare: (sessionId: string) =>
    get<CompareResult>(`${BASE}/sessions/${seg(sessionId)}/compare`),

  policy: (command: string) => post<PolicyResult>(`${BASE}/algo/policy`, { command }),
};

/**
 * Chạy lệnh và đọc stream NDJSON từng dòng.
 * Backend trả {type:"output"…} → … → {type:"result"} hoặc {type:"error"}.
 */
export async function* execStream(
  sessionId: string,
  body: ExecBody,
  signal: AbortSignal,
): AsyncGenerator<ExecEvent, void, undefined> {
  const response = await fetch(`${BASE}/sessions/${seg(sessionId)}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      if (text) {
        const payload = JSON.parse(text) as { error?: { message?: string }; detail?: unknown };
        if (typeof payload.error?.message === "string") message = payload.error.message;
        else if (payload.detail !== undefined) message = String(payload.detail);
      }
    } catch {
      /* giữ message HTTP mặc định */
    }
    throw new Error(message);
  }

  for await (const raw of readNdjson(response)) {
    const event = raw as ExecEvent;
    if (event && typeof event === "object" && typeof event.type === "string") {
      yield event;
    }
  }
}

/** Tìm phiên RUNNING của một sandbox (điều kiện để exec/sync/compare). */
export function runningSession(overview: Overview | null, sandboxId: string | null): SessionRow | null {
  if (!overview || !sandboxId) return null;
  return overview.sessions.find((s) => s.sandbox_id === sandboxId && s.state === "RUNNING") ?? null;
}
