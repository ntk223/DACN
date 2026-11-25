import type { ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { formatBytes, formatTime } from "@/lib/format";
import type { WorkspaceDetail } from "./types";

/** Khối meta của workspace đang chọn: id, revision, phiên, demo + thanh hạn mức. */
export function WorkspaceMeta({ detail }: { detail: WorkspaceDetail }) {
  const { summary, quota_bytes } = detail;
  const used = summary.used_bytes;
  const pct = quota_bytes > 0 ? (used / quota_bytes) * 100 : 0;
  const sessions = detail.sessions
    .map((s) => `${s.state}${s.sandbox_id ? ` (${s.sandbox_id})` : ""}`)
    .join(", ");

  const rows: Array<{ key: string; value: ReactNode }> = [
    { key: "id", value: detail.workspace.id },
    { key: "tạo lúc", value: detail.workspace.created_at ? formatTime(detail.workspace.created_at) : "—" },
    { key: "revision", value: summary.revision },
    {
      key: "policy",
      value: (
        <Badge tone={summary.conflict_policy === "error" ? "yellow" : "default"}>
          {`policy: ${summary.conflict_policy ?? "—"}`}
        </Badge>
      ),
    },
    { key: "phiên", value: sessions.length > 0 ? sessions : "—" },
    { key: "demo", value: detail.demonstrates ?? "—" },
  ];

  return (
    <div>
      <dl className="vfs-kv">
        {rows.map((row) => (
          <div key={row.key} className="vfs-kv-pair">
            <dt>{row.key}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="vfs-bar" style={{ marginTop: 8 }}>
        <div
          style={{
            width: `${Math.min(100, pct)}%`,
            background: pct > 90 ? "var(--color-danger)" : pct > 70 ? "var(--color-warning)" : "var(--color-success)",
          }}
        />
      </div>
      <div className="vfs-dim vfs-small" style={{ marginTop: 3 }}>
        {`${formatBytes(used)} / ${formatBytes(quota_bytes)} (${pct.toFixed(pct < 1 ? 3 : 1)}%)`}
      </div>
    </div>
  );
}
