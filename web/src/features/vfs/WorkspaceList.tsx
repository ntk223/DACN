import { useState } from "react";

import { Badge } from "@/components/Badge";
import { formatBytes } from "@/lib/format";
import type { OpenVfsOps } from "@/lib/nav";
import type { Overview, WorkspaceSummaryItem } from "./types";

interface WorkspaceListProps {
  overview: Overview;
  /** Workspace đang hiển thị ở vùng tabs bên dưới — chỉ dùng để highlight. */
  activeId: string | null;
  /** Bấm cả hàng → mở trang Thao tác tại workspace này (tuỳ chọn). */
  onOpenOps?: OpenVfsOps;
}

/** Màu thanh hạn mức: >90% đỏ, >70% cam, còn lại xanh. */
export function quotaColor(used: number, quota: number): string {
  const pct = quota > 0 ? (used / quota) * 100 : 0;
  if (pct > 90) return "var(--color-danger)";
  if (pct > 70) return "var(--color-warning)";
  return "var(--color-success)";
}

/**
 * Một dòng workspace — THÔNG TIN THUẦN, không có nút bấm riêng.
 * Bấm vào bất kỳ đâu trên hàng → mở trang Thao tác tại workspace này.
 */
function WorkspaceRow({
  item,
  quota,
  active,
  onOpen,
}: {
  item: WorkspaceSummaryItem;
  quota: number;
  active: boolean;
  onOpen?: () => void;
}) {
  const used = item.used_bytes ?? 0;
  const pct = quota > 0 ? (used / quota) * 100 : 0;
  return (
    <div
      className={`vfs-ws${active ? " active" : ""}`}
      title="Bấm để xem chi tiết & thao tác"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") onOpen?.();
      }}
    >
      <div className="vfs-row">
        <span className="vfs-ws-name vfs-grow">{item.name ?? item.id}</span>
        {item.conflict_policy !== null && item.conflict_policy !== undefined ? (
          <Badge tone={item.conflict_policy === "error" ? "yellow" : "default"} title="Chính sách xung đột ghi">
            {item.conflict_policy}
          </Badge>
        ) : null}
        {item.missing_db ? <Badge tone="yellow" title="DB dự án chưa tạo">thiếu DB</Badge> : null}
        {item.session_id ? (
          <Badge tone="green" title={`Phiên sandbox đang gắn với workspace: ${item.session_id}`}>
            phiên đang chạy
          </Badge>
        ) : null}
      </div>
      <div className="vfs-ws-meta">
        {item.name ? `${item.id} · ` : ""}
        {item.file_count ?? 0} file · rev {item.revision ?? 0} · {formatBytes(used)}
      </div>
      {item.demonstrates ? <div className="vfs-ws-meta">{item.demonstrates}</div> : null}
      <div className="vfs-ws-quota" title={`${pct.toFixed(1)}% hạn mức`}>
        <div className="meter">
          <div style={{ width: `${Math.min(100, pct)}%`, background: quotaColor(used, quota) }} />
        </div>
        <span className="vfs-ws-pct">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

/**
 * Danh sách workspace ở trang Quản lý — chỉ HIỂN THỊ thông tin
 * (tên, hạn mức, policy, số file, phiên đang chạy). Bấm cả hàng → trang Thao tác.
 * Tạo workspace đã chuyển xuống trang Thao tác (nút "+ Workspace").
 */
export function WorkspaceList({ overview, activeId, onOpenOps }: WorkspaceListProps) {
  const [filter, setFilter] = useState("");

  const query = filter.trim().toLowerCase();
  const items = overview.workspaces.filter(
    (w) => query.length === 0 || `${w.id} ${w.name ?? ""}`.toLowerCase().includes(query),
  );

  return (
    <div>
      <div className="vfs-row">
        <input
          className="input vfs-grow"
          value={filter}
          placeholder="lọc theo tên / id…"
          aria-label="Lọc workspace"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.length === 0 ? (
          <div className="vfs-dim vfs-small" style={{ textAlign: "center", padding: "10px 0" }}>
            {overview.workspaces.length > 0
              ? "Không khớp. Thử từ khóa khác hoặc xóa trắng ô lọc."
              : "Chưa có workspace. Chạy `make seed` hoặc bấm + Workspace ở trang Thao tác."}
          </div>
        ) : (
          // Mới nhất lên đầu như trang cũ (danh sách seed theo thứ tự tạo).
          [...items].reverse().map((item) => (
            <WorkspaceRow
              key={item.id}
              item={item}
              quota={overview.settings.workspace_quota_bytes}
              active={item.id === activeId}
              onOpen={onOpenOps !== undefined ? () => onOpenOps(item.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
