import { useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { formatBytes } from "@/lib/format";
import type { Overview, WorkspaceSummaryItem } from "./types";

interface WorkspaceListProps {
  overview: Overview;
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, conflictPolicy: string) => Promise<void>;
}

/** Màu thanh hạn mức: >90% đỏ, >70% cam, còn lại xanh. */
function quotaTone(used: number, quota: number): string {
  const pct = quota > 0 ? (used / quota) * 100 : 0;
  if (pct > 90) return "var(--color-danger)";
  if (pct > 70) return "var(--color-warning)";
  return "var(--color-success)";
}

function WorkspaceRow({
  item,
  quota,
  active,
  onSelect,
}: {
  item: WorkspaceSummaryItem;
  quota: number;
  active: boolean;
  onSelect: () => void;
}) {
  const used = item.used_bytes ?? 0;
  const pct = quota > 0 ? (used / quota) * 100 : 0;
  return (
    <div
      className={`vfs-ws${active ? " active" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div className="vfs-row">
        <span className="vfs-ws-name">{item.name ?? item.id}</span>
        {item.missing_db ? <Badge tone="yellow" title="DB dự án chưa tạo">thiếu DB</Badge> : null}
      </div>
      <div className="vfs-ws-meta">
        {item.name ? `${item.id} · ` : ""}
        {item.file_count ?? 0} file · rev {item.revision ?? 0} · {formatBytes(used)}
      </div>
      {item.demonstrates ? <div className="vfs-ws-meta">{item.demonstrates}</div> : null}
      <div className="vfs-bar" title={`${pct.toFixed(1)}% hạn mức`}>
        <div style={{ width: `${Math.min(100, pct)}%`, background: quotaTone(used, quota) }} />
      </div>
    </div>
  );
}

/** Cột trái trên: lọc + danh sách workspace kèm thanh hạn mức + form tạo mới. */
export function WorkspaceList({ overview, activeId, onSelect, onCreate }: WorkspaceListProps) {
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState("sandbox_wins");
  const [busy, setBusy] = useState(false);

  const query = filter.trim().toLowerCase();
  const items = overview.workspaces.filter(
    (w) => query.length === 0 || `${w.id} ${w.name ?? ""}`.toLowerCase().includes(query),
  );

  const submit = async () => {
    setBusy(true);
    try {
      await onCreate(name.trim(), policy);
      setCreating(false);
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {creating ? (
        <div style={{ marginBottom: 10 }}>
          <input
            className="input"
            value={name}
            placeholder="tên (tùy chọn)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          <div className="vfs-row" style={{ marginTop: 8 }}>
            <select className="select vfs-grow" value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <option value="sandbox_wins">sandbox_wins</option>
              <option value="error">error</option>
            </select>
            <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
              Tạo
            </Button>
          </div>
        </div>
      ) : null}
      <div className="vfs-row">
        <input
          className="input vfs-grow"
          value={filter}
          placeholder="lọc theo tên / id…"
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          + Mới
        </Button>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.length === 0 ? (
          <div className="vfs-dim vfs-small" style={{ textAlign: "center", padding: "10px 0" }}>
            {overview.workspaces.length > 0
              ? "Không khớp."
              : "Chưa có workspace. Chạy `make seed`."}
          </div>
        ) : (
          // Mới nhất lên đầu như trang cũ (danh sách seed theo thứ tự tạo).
          [...items].reverse().map((item) => (
            <WorkspaceRow
              key={item.id}
              item={item}
              quota={overview.settings.workspace_quota_bytes}
              active={item.id === activeId}
              onSelect={() => onSelect(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
