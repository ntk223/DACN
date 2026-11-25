/**
 * api.ts — client fetch gọn cho REST gateway.
 * Chuẩn hóa lỗi về ApiError {code, message} bất kể backend trả:
 *   - AppError FastAPI: {"error": {"code": "...", "message": "...", "details"?...}}
 *   - FastAPI mặc định: {"detail": "..."} hoặc {"detail": [...]} (validation)
 * throwOnError: mọi hàm tự throw ApiError khi HTTP != 2xx (caller chỉ cần try/catch).
 */

export interface ApiErrorShape {
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  /** HTTP status gốc, tiện phân nhánh UI (404 hiển thị khác 500). */
  readonly status: number;

  constructor(err: ApiErrorShape, status: number) {
    super(err.message);
    this.name = "ApiError";
    this.code = err.code;
    this.status = status;
  }
}

interface ErrorPayload {
  error?: { code?: unknown; message?: unknown };
  detail?: unknown;
}

/** Quy mọi biến thể lỗi backend về {code, message}. */
function normalizeError(payload: unknown, status: number): ApiErrorShape {
  const body = (payload ?? {}) as ErrorPayload;

  // Dạng chuẩn của gateway: {"error": {"code", "message"}}
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

  // FastAPI mặc định: {"detail": "..."}
  if (typeof body.detail === "string" && body.detail.length > 0) {
    return { code: "http_error", message: body.detail };
  }

  // FastAPI validation: {"detail": [{loc, msg, ...}, ...]}
  if (Array.isArray(body.detail)) {
    const parts = body.detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter((s): s is string => s !== null);
    return {
      code: "validation_error",
      message: parts.length > 0 ? parts.join("; ") : `HTTP ${status}`,
    };
  }

  return {
    code: "unknown_error",
    message: `Lỗi không xác định (HTTP ${status})`,
  };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Backend trả text thuần (hiếm) — giữ nguyên chuỗi.
    return text;
  }
}

export interface RequestOptions {
  /** Query params; giá trị null/undefined bị bỏ qua. */
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(buildUrl(path, options?.query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  });

  if (!response.ok) {
    const payload = await parseBody(response);
    throw new ApiError(normalizeError(payload, response.status), response.status);
  }

  return (await parseBody(response)) as T;
}

export function get<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

export function post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function del<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("DELETE", path, undefined, options);
}

/** PUT dùng cho upload chunk (body là Blob, không JSON). */
export async function putRaw(path: string, body: Blob | ArrayBuffer, signal?: AbortSignal): Promise<void> {
  const response = await fetch(path, { method: "PUT", body, signal });
  if (!response.ok) {
    const payload = await parseBody(response);
    throw new ApiError(normalizeError(payload, response.status), response.status);
  }
}
