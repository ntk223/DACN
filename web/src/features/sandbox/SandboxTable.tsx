/**
 * SandboxTable.tsx — bảng THÔNG TIN thuần các phiên (trang Quản lý).
 * Mỗi hàng chỉ hiển thị: phiên/workspace, sandbox_id, trạng thái (badge dot),
 * drift, đồng bộ, TTL còn lại (cảnh báo màu), tạo/hết hạn. Bấm vào hàng nào
 * cũng jump sang trang Thao tác của phiên đó (onOpenOps) — kể cả STANDBY
 * (sang Thao tác để bật). Hàng nhận focus bàn phím (Enter/Space mở).
 * Ngoại lệ duy nhất còn nút: sandbox mồ côi (Dọn là việc quản trị hệ thống —
 * xác nhận qua ConfirmDialog dùng chung).
 * Bảng chỉ đọc nên không giữ trạng thái chọn — dữ liệu từ useSandboxData.
 */
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { StateBadge } from "@/components/StateBadge";
import type { ToastKind } from "@/components/Toast";
import { providerTone } from "@/lib/format";
import type { OpenSandboxOps } from "@/lib/nav";
import { useState } from "react";
import { sandboxApi } from "./sandboxApi";
import type { OrphanRow, SessionRow } from "./types";
import { remainLabel, timeLabel } from "./util";

type Notify = (message: string, kind?: ToastKind) => void;

export interface SandboxTableProps {
  sessions: SessionRow[];
  orphans: OrphanRow[];
  /**
   * Mở trang Thao tác cho phiên (App tự chuyển trang) — bấm vào hàng nào
   * cũng jump, kể cả phiên STANDBY (sang Thao tác để bật sandbox).
   */
  onOpenOps?: OpenSandboxOps;
  /** Gọi lại sau khi dọn mồ côi thành công để tải dữ liệu mới. */
  onChanged: () => void;
  notify: Notify;
}

/** Mức khẩn của TTL: rỗng (bình thường) / warn (<10 phút) / critical (<2 phút). */
export function ttlUrgency(iso: string | null | undefined): "" | "sbx-ttl-warn" | "sbx-ttl-critical" {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  if (ms <= 2 * 60 * 1000) return "sbx-ttl-critical";
  if (ms <= 10 * 60 * 1000) return "sbx-ttl-warn";
  return "";
}

export function SandboxTable({ sessions, orphans, onOpenOps, onChanged, notify }: SandboxTableProps) {
  const liveCount = sessions.filter(
    (s) => s.state === "RUNNING" || s.state === "PAUSED",
  ).length;
  /** Mồ côi đang chờ xác nhận dọn (hộp thoại xác nhận dùng chung). */
  const [orphanTarget, setOrphanTarget] = useState<OrphanRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const removeOrphan = async (orphan: OrphanRow) => {
    setRemoving(true);
    try {
      await sandboxApi.deleteOrphan(orphan.sandbox_id);
      notify(`Đã dọn ${orphan.sandbox_id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dọn thất bại", "error");
    }
    setRemoving(false);
    setOrphanTarget(null);
    onChanged();
  };

  return (
    <div className="sbx-col">
      <Card
        title="Phiên làm việc"
        actions={<span className="sbx-meta">{sessions.length} phiên · {liveCount} đang có sandbox</span>}
      >
        {sessions.length === 0 ? (
          <EmptyState title="Chưa có phiên nào">
            Tạo workspace ở trang Quản lý VFS, rồi bật sandbox từ trang Thao tác.
          </EmptyState>
        ) : (
          <div className="sbx-tblwrap">
            <table className="table sbx-table">
              <thead>
                <tr>
                  <th>Phiên</th>
                  <th>Sandbox ID</th>
                  <th>Trạng thái</th>
                  <th>Đồng bộ</th>
                  <th>TTL còn lại</th>
                  <th>Tạo / Hết hạn</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((row) => {
                  const live =
                    (row.state === "RUNNING" || row.state === "PAUSED") && row.sandbox_id;
                  const ttlClass = live ? ttlUrgency(row.expires_at) : "";
                  return (
                    <tr
                      key={row.session_id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Mở trang Thao tác cho phiên ${row.workspace_name ?? row.workspace_id}`}
                      // Bấm hàng nào cũng jump trang Thao tác — kể cả STANDBY (để bật).
                      onClick={() => onOpenOps?.(row.session_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenOps?.(row.session_id);
                        }
                      }}
                      title="Bấm để xem chi tiết & thao tác"
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.workspace_name ?? row.workspace_id}</div>
                        <div className="sbx-meta sbx-mono">
                          ws {row.workspace_id} · phiên {row.session_id.slice(0, 12)}…
                        </div>
                      </td>
                      <td>
                        {row.sandbox_id ? (
                          <span className="sbx-mono">{row.sandbox_id}</span>
                        ) : (
                          <span className="sbx-meta">—</span>
                        )}
                      </td>
                      <td>
                        <div className="sbx-badges">
                          <StateBadge state={row.state} />
                          {live ? (
                            <Badge
                              tone={providerTone(row.provider_state)}
                              title="Trạng thái thật theo provider (Docker)"
                            >
                              thực tế: {row.provider_state ?? "mất"}
                            </Badge>
                          ) : null}
                          {row.drift ? (
                            <Badge
                              tone="red"
                              title="Lệch sổ: trạng thái ghi sổ trong DB khác với thực tế của provider (Docker). Kiểm tra lại phiên, hoặc dừng & bật lại để đồng bộ."
                            >
                              ⚠ Lệch sổ
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td>{live && row.sync ? <SyncBadge sync={row.sync} /> : <span className="sbx-meta">—</span>}</td>
                      <td>
                        {live ? (
                          <span className={`sbx-ttl${ttlClass ? ` ${ttlClass}` : ""}`}>
                            {remainLabel(row.expires_at)}
                          </span>
                        ) : (
                          <span className="sbx-ttl">—</span>
                        )}
                      </td>
                      <td>
                        <div className="sbx-meta">
                          tạo {timeLabel(row.created_at)}
                        </div>
                        <div className="sbx-meta">
                          hết hạn {timeLabel(row.expires_at)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Sandbox mồ côi"
        actions={<span className="sbx-meta">provider còn giữ, không phiên nào dùng</span>}
      >
        {orphans.length === 0 ? (
          <EmptyState title="Không có sandbox mồ côi" />
        ) : (
          <div className="sbx-col">
            {orphans.map((orphan) => (
              <div key={orphan.sandbox_id} className="sbx-orphan">
                <div className="sbx-badges">
                  <span className="sbx-mono" style={{ fontWeight: 600 }}>{orphan.sandbox_id}</span>
                  {orphan.state ? <Badge tone={providerTone(orphan.state)}>{orphan.state}</Badge> : null}
                </div>
                <div className="sbx-meta">
                  phiên {orphan.session_id ?? "?"} · tạo {timeLabel(orphan.created_at)}
                </div>
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="sbx-btn-danger-ghost"
                    onClick={() => setOrphanTarget(orphan)}
                  >
                    Dọn sandbox + volume
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Xác nhận dọn mồ côi — sandbox + volume bị xóa vĩnh viễn */}
      <ConfirmDialog
        open={orphanTarget !== null}
        title="Dọn sandbox mồ côi"
        message={`Xóa sandbox ${orphanTarget?.sandbox_id ?? ""} và volume của nó? Dữ liệu trong sandbox sẽ mất vĩnh viễn (file trong kho VFS không bị ảnh hưởng).`}
        confirmLabel="Dọn sandbox + volume"
        danger
        busy={removing}
        onConfirm={() => {
          if (orphanTarget) void removeOrphan(orphanTarget);
        }}
        onClose={() => setOrphanTarget(null)}
      />
    </div>
  );
}

/** Badge trạng thái đồng bộ (dùng trong bảng Quản lý và tab Đồng bộ). */
export function SyncBadge({ sync }: { sync: NonNullable<SessionRow["sync"]> }) {
  if (sync.status === "stale") {
    return (
      <Badge tone="red" title="Đồng bộ lỗi — có thay đổi chưa đẩy được sang sandbox, bấm “Đồng bộ ngay” để đẩy lại.">
        lỗi — chờ đẩy lại ({sync.pending_push ?? 0})
      </Badge>
    );
  }
  if ((sync.pending_push ?? 0) > 0) {
    return (
      <Badge tone="yellow" title="Có thay đổi trong kho chưa đẩy sang sandbox.">
        chờ đẩy {sync.pending_put ?? 0} file, {sync.pending_delete ?? 0} xóa
      </Badge>
    );
  }
  return (
    <Badge tone="green" title="Kho VFS và sandbox đã cùng revision.">
      đã khớp · rev {sync.synced_revision ?? "?"}
    </Badge>
  );
}
