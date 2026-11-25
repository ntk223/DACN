/**
 * format.ts — hàm định dạng hiển thị (vi-VN). Không phụ thuộc React.
 */

/** 1536 -> "1.5 KB"; dùng đơn vị nhị phân 1024. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/** ms -> "1.2 s" / "3 m 05 s" / "1 h 12 m"; <1000ms trả "120 ms". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} m`;
  if (minutes > 0) return `${minutes} m ${String(seconds).padStart(2, "0")} s`;
  if (seconds < 10) return `${(ms / 1000).toFixed(1)} s`;
  return `${seconds} s`;
}

/** ISO string | epoch(ms) -> "25/11/2026 14:03:07" theo vi-VN. */
export function formatTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Cắt đường/dòng dài để vừa bảng: giữ phần đuôi (quan trọng hơn),
 * ví dụ truncPath("/very/long/.../main.py", 24) -> "…/main.py".
 */
export function truncPath(path: string, maxLength = 32): string {
  if (path.length <= maxLength) return path;
  const suffix = path.slice(-Math.floor(maxLength * 0.7));
  return `…${suffix}`;
}
