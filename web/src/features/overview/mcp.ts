/**
 * mcp.ts — lớp gọi JSON-RPC POST /mcp/ (tools/call).
 * Port cách xử lý của trang admin cũ: parse được cả JSON thuần LẪN SSE
 * (các dòng "data: {...}"), ưu tiên structuredContent rồi mới đến content[0].text.
 */

import { ApiError } from "@/lib/api";

export interface McpCallOutcome {
  /** Kết quả tool (đã extract) — hoặc nguyên payload khi lỗi JSON-RPC. */
  data: unknown;
  /** true khi lỗi nằm trong response (HTTP vẫn 200). */
  isError: boolean;
  /** Thời gian gọi (ms) — hiển thị cạnh kết quả. */
  ms: number;
}

let rpcId = 0;

/** Thu gọn object về Record để tra cứu an toàn. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** SSE: các dòng "data: {...}" — thử parse từ dưới lên (kết quả thường nằm cuối). */
function parseSsePayload(text: string): unknown {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      /* dòng hỏng — thử dòng data: trước đó */
    }
  }
  return null;
}

/** Kết quả tools/call: ưu tiên structuredContent, fallback parse content[0].text. */
export function extractToolResult(result: unknown): unknown {
  if (!isObject(result)) return result;
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (Array.isArray(result.content)) {
    const first: unknown = result.content[0];
    if (isObject(first) && typeof first.text === "string") {
      try {
        return JSON.parse(first.text) as unknown;
      } catch {
        return first.text;
      }
    }
  }
  return result;
}

/** Gọi 1 tool MCP. Lỗi mạng/parse → throw; lỗi nghiệp vụ → trả isError=true. */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpCallOutcome> {
  const started = performance.now();
  rpcId += 1;
  const body = { jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name, arguments: args } };
  const response = await fetch("/mcp/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  let payload: unknown;
  if (contentType.includes("text/event-stream")) {
    payload = parseSsePayload(text);
  } else {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = parseSsePayload(text);
    }
  }
  if (payload === null) {
    throw new ApiError(
      { code: "parse_error", message: `Phản hồi không parse được (JSON/SSE): ${text.slice(0, 200)}` },
      response.status,
    );
  }

  const ms = Math.round(performance.now() - started);
  const record = isObject(payload) ? payload : {};

  // Lỗi tầng JSON-RPC: giữ nguyên payload để hiển thị {error: {...}}.
  if (record.error !== undefined && record.error !== null) {
    return { data: payload, isError: true, ms };
  }

  const result = record.result !== undefined ? record.result : payload;
  const data = extractToolResult(result);
  // Lỗi nghiệp vụ nằm trong result (HTTP 200): {"error": {...}}.
  const isError = isObject(data) && data.error !== undefined;
  return { data, isError, ms };
}

/** JSON.stringify an toàn (vòng tham chiếu → String). */
export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
