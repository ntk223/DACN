/**
 * states.tsx — trạng thái loading / rỗng / lỗi dùng chung trong feature overview.
 * Headline 15px (font-size-base, weight 600) + mô tả 13px (font-size-sm, muted)
 * theo UX-GUIDE.md — không dùng EmptyState 17px của components cho các trạng thái này.
 */

import type { ReactNode } from "react";

import { Spinner } from "@/components/Spinner";

interface OvStateProps {
  /** Icon minh họa hoặc Spinner (trạng thái loading). */
  icon?: ReactNode;
  /** Headline 15px. */
  title: ReactNode;
  /** Mô tả 13px muted. */
  description?: ReactNode;
  children?: ReactNode;
}

export function OvState({ icon, title, description, children }: OvStateProps) {
  return (
    <div className="ov-state">
      {icon !== undefined ? <div className="ov-state-icon">{icon}</div> : null}
      <div className="ov-state-title">{title}</div>
      {description !== undefined ? <div className="ov-state-desc">{description}</div> : null}
      {children}
    </div>
  );
}

/** Trạng thái đang nạp — Spinner lớn + headline/description đúng cỡ chuẩn. */
export function OvLoading({ title, description }: { title: string; description?: string }) {
  return <OvState icon={<Spinner large />} title={title} description={description} />;
}
