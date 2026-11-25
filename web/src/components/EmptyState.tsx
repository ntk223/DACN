import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Icon SVG hoặc ký tự minh họa (tuỳ chọn). */
  icon?: ReactNode;
  title: ReactNode;
  /** Mô tả thêm hoặc nút hành động. */
  description?: ReactNode;
  children?: ReactNode;
}

/** Trạng thái trống — dùng trong card/bảng khi chưa có dữ liệu. */
export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon !== undefined ? <div style={{ fontSize: 28, opacity: 0.5 }}>{icon}</div> : null}
      <div className="empty-state-title">{title}</div>
      {description !== undefined ? (
        <div style={{ fontSize: "var(--font-size-sm)" }}>{description}</div>
      ) : null}
      {children}
    </div>
  );
}
