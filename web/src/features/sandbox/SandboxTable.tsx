/**
 * SandboxTable.tsx — bảng THÔNG TIN thuần các phiên (trang Quản lý).
 * Mỗi hàng chỉ hiển thị: phiên/workspace, sandbox_id, trạng thái (badge dot),
 * drift, đồng bộ, TTL còn lại (cảnh báo màu), tạo/hết hạn. Bấm vào hàng nào
 * cũng jump sang trang Thao tác của phiên đó (onOpenOps) — kể cả STANDBY
 * (sang Thao tác để bật). Không còn cột hành động hay modal ở bảng này.
 * Ngoại lệ duy nhất còn nút: sandbox mồ côi (Dọn là việc quản trị hệ thống).
 * Bảng chỉ đọc nên không giữ trạng thái chọn — dữ liệu từ useSandboxData.
 */
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import type { OpenSandboxOps } from "@/lib/nav";
import { sandboxApi } from "./sandboxApi";
import type { OrphanRow, SessionRow } from "./types";
import { remainLabel, timeLabel } from "./util";

type Notify = (message: string, kind?: "ok" | "err" | "warn") => void;

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

/** Badge tone theo trạng thái ghi sổ (DB). */
function stateTone(state: string): "green" | "yellow" | "gray" {
  if (state === "RUNNING") return "green";
  if (state === "PAUSED") return "yellow";
  return "gray";
}

/** Badge tone theo trạng thái thật của provider (Docker). */
export function providerTone(state: string | null | undefined): "green" | "yellow" | "red" {
  if (state === "running") return "green";
  if (state === "paused") return "yellow";
  return "red";
}

/** Nhãn tiếng Việt + tooltip giải thích cho trạng thái ghi sổ. */
const STATE_LABELS: Record<string, { label: string; hint: string }> = {
  STANDBY: { label: "Chờ bật", hint: "Phiên chưa có sandbox — bật ở trang Thao tác." },
  STARTING: { label: "Đang bật", hint: "Provider đang khởi tạo container, chờ vài giây rồi tải lại." },
  RUNNING: { label: "Đang chạy", hint: "Sandbox đang chạy — bấm hàng để sang trang Thao tác." },
  PAUSED: { label: "Tạm dừng", hint: "Container bị pause — bấm hàng để sang trang Thao tác và tiếp tục." },
};

/** Badge trạng thái có chấm tròn trước chữ (RUNNING xanh / PAUSED vàng / còn lại xám). */
export function StateBadge({ state }: { state: string }) {
  const tone = stateTone(state);
  const meta = STATE_LABELS[state] ?? { label: state, hint: `Trạng thái ghi sổ: ${state}` };
  return (
    <Badge tone={tone} title={meta.hint}>
      <span className={`sbx-dot${state === "RUNNING" ? " sbx-dot-live" : ""}`} aria-hidden="true" />
      {meta.label}
    </Badge>
  );
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

  const removeOrphan = async (orphan: OrphanRow) => {
    if (!window.confirm(`Xóa sandbox ${orphan.sandbox_id} và volume của nó?`)) {
      return;
    }
    try {
      await sandboxApi.deleteOrphan(orphan.sandbox_id);
      notify(`Đã dọn ${orphan.sandbox_id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dọn thất bại", "err");
    }
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
          <div style={{ overflowX: "auto" }}>
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
                      // Bấm hàng nào cũng jump trang Thao tác — kể cả STANDBY (để bật).
                      onClick={() => onOpenOps?.(row.session_id)}
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
                    onClick={() => void removeOrphan(orphan)}
                  >
                    Dọn sandbox + volume
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
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
