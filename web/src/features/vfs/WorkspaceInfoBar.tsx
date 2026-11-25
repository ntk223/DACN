import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatBytes } from "@/lib/format";
import type { OpenSandboxOps } from "@/lib/nav";
import { quotaTone } from "./WorkspaceList";
import type { SessionRow, WorkspaceDetail } from "./types";

/** Icon terminal cho nút "Sang Sandbox". */
function TerminalIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M12 15h5" />
    </svg>
  );
}

/**
 * Phiên đang gắn với workspace — trạng thái còn thao tác được trên sandbox:
 * RUNNING (đang chạy) hoặc PAUSED (tạm dừng). null nếu chưa có phiên nào.
 */
export function attachedSession(sessions: SessionRow[]): SessionRow | null {
  return sessions.find((s) => s.state === "RUNNING" || s.state === "PAUSED") ?? null;
}

interface WorkspaceInfoBarProps {
  detail: WorkspaceDetail;
  onOpenSandboxOps?: OpenSandboxOps;
}

/**
 * Thanh thông tin workspace mỏng, sits ngay trên editor ở trang Thao tác:
 * tên + id, badge policy, thống kê file/rev/dung lượng, phiên đang chạy,
 * hạn mức + % — và đường nhanh "Sang Sandbox" khi có phiên RUNNING/PAUSED.
 */
export function WorkspaceInfoBar({ detail, onOpenSandboxOps }: WorkspaceInfoBarProps) {
  const id = detail.workspace.id;
  const name = detail.name ?? id;
  const used = detail.summary.used_bytes;
  const quota = detail.quota_bytes;
  const pct = quota > 0 ? (used / quota) * 100 : 0;
  const policy = detail.summary.conflict_policy;
  const session = attachedSession(detail.sessions);
  const sessionId = session?.session_id ?? session?.sandbox_id ?? null;
  const canJump = session !== null && sessionId !== null && onOpenSandboxOps !== undefined;

  return (
    <Card className="vfs-wsinfo">
      <div className="vfs-row">
        <span className="vfs-wsinfo-name">{name}</span>
        <span className="mono vfs-small vfs-dim" title="Workspace id">
          {id}
        </span>
        {policy !== null && policy !== undefined ? (
          <Badge tone={policy === "error" ? "yellow" : "default"} title="Chính sách xung đột ghi">
            {policy}
          </Badge>
        ) : null}
        {session !== null ? (
          <Badge
            tone={session.state === "RUNNING" ? "green" : "yellow"}
            title={`Phiên sandbox gắn với workspace · ${session.state}`}
          >
            {(sessionId ?? "?").slice(0, 8)} · {session.state}
          </Badge>
        ) : null}
        <span className="vfs-grow" />
        {canJump && sessionId !== null && onOpenSandboxOps !== undefined ? (
          <Button
            size="sm"
            title="Thao tác trên sandbox của workspace này"
            onClick={() => onOpenSandboxOps(sessionId)}
          >
            <TerminalIcon />
            Sang Sandbox
          </Button>
        ) : session !== null ? null : (
          <span className="vfs-dim vfs-small" title="Workspace chưa có phiên sandbox đang chạy">
            chưa có phiên
          </span>
        )}
      </div>
      <div className="vfs-row">
        <span className="vfs-small vfs-dim" title="Số file · revision · dung lượng đã dùng">
          {detail.summary.file_count} file · rev {detail.summary.revision} · {formatBytes(used)}
        </span>
        <div className="vfs-ws-quota vfs-grow" title={`${pct.toFixed(1)}% hạn mức`}>
          <div className="vfs-bar">
            <div style={{ width: `${Math.min(100, pct)}%`, background: quotaTone(used, quota) }} />
          </div>
          <span className="vfs-ws-pct">{pct.toFixed(0)}%</span>
        </div>
      </div>
    </Card>
  );
}
