/**
 * ndjson.ts — parse NDJSON stream từ Response (dùng cho exec console, log stream).
 * Mỗi dòng hợp lệ (không rỗng) được JSON.parse và yield ra qua async generator.
 *
 * Ví dụ:
 *   for await (const event of readNdjson(response)) { ... }
 */
export async function* readNdjson(response: Response): AsyncGenerator<unknown, void, undefined> {
  if (!response.body) {
    throw new Error("Response không có body để stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Xử lý từng dòng hoàn chỉnh trong buffer.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length === 0) continue;
        try {
          yield JSON.parse(line) as unknown;
        } catch {
          // Dòng hỏng (không phải JSON) — bỏ qua, không làm gãy cả stream.
        }
      }
    }

    // Phần cuối buffer không kết thúc bằng \n.
    const tail = buffer.trim();
    if (tail.length > 0) {
      try {
        yield JSON.parse(tail) as unknown;
      } catch {
        /* bỏ qua dòng hỏng */
      }
    }
  } finally {
    reader.releaseLock();
  }
}
