/**
 * util.ts — helper hiển thị riêng cho feature sandbox.
 */
import { formatTime } from "@/lib/format";

/** Thời gian còn lại đến hạn: "còn 1h 05m" / "đã quá hạn" / "không hết hạn". */
export function remainLabel(iso: string | null | undefined): string {
  if (!iso) return "không hết hạn";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Number.isNaN(seconds)) return iso;
  if (seconds <= 0) return "đã quá hạn";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `còn ${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `còn ${minutes}m`;
}

/** ISO → giờ vi-VN (bọc formatTime để chỗ dùng gọn). */
export function timeLabel(iso: string | null | undefined): string {
  return iso ? formatTime(iso) : "—";
}

/** Ghép giới hạn tài nguyên: "2 CPU · 512 MB" / "CPU tự do · RAM tự do". */
export function limitsLabel(cpu?: number | null, memoryMb?: number | null): string {
  const cpuPart = cpu ? `${cpu} CPU` : "CPU tự do";
  const memPart = memoryMb ? `${memoryMb} MB` : "RAM tự do";
  return `${cpuPart} · ${memPart}`;
}
