import type { ReactNode } from "react";

interface ToolbarProps {
  /** Phần bên trái: nút chính, ô tìm kiếm… */
  left?: ReactNode;
  /** Phần bên phải: nút phụ, bộ lọc… */
  right?: ReactNode;
}

/** Hàng công cụ trên cùng của mỗi page — trái là hành động chính, phải là phụ. */
export function Toolbar({ left, right }: ToolbarProps) {
  if (left === undefined && right === undefined) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{left}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{right}</div>
    </div>
  );
}
