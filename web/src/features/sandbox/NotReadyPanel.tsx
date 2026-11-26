/**
 * NotReadyPanel.tsx — card cột phải cho phiên CHƯA có sandbox (tách từ
 * SandboxOpsPage): STANDBY → banner "chưa bật" + nút Bật (mở StartModal);
 * STARTING → banner "đang bật…" (provider đang khởi tạo, chỉ chờ).
 */
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import type { SessionRow } from "./types";

interface NotReadyPanelProps {
  /** Phiên STANDBY/STARTING đang chọn ở cột trái. */
  session: SessionRow;
  /** Bấm "Bật sandbox" — caller mở StartModal cho phiên này. */
  onStart: (session: SessionRow) => void;
}

/** Card trạng thái phiên chưa có sandbox: STANDBY (cho bật) / STARTING (đang chờ). */
export function NotReadyPanel({ session, onStart }: NotReadyPanelProps) {
  if (session.state === "STANDBY") {
    return (
      <Card
        title={<span style={{ fontWeight: 600 }}>{session.workspace_name ?? session.workspace_id}</span>}
        actions={
          <span className="sbx-meta sbx-mono">
            ws {session.workspace_id} · phiên {session.session_id.slice(0, 12)}…
          </span>
        }
      >
        <div className="sbx-banner-warn" role="status" style={{ marginBottom: 12 }}>
          <span>
            <b>Phiên này chưa bật sandbox</b> — bật để chạy lệnh, xem file và đồng bộ.
          </span>
          <Button size="sm" variant="primary" onClick={() => onStart(session)}>
            Bật sandbox
          </Button>
        </div>
        <EmptyState title="Sandbox chưa khởi tạo">
          Bấm “Bật sandbox” phía trên, chọn TTL và tài nguyên rồi xác nhận.
        </EmptyState>
      </Card>
    );
  }

  // STARTING — provider đang khởi tạo container, chỉ chờ rồi tải lại.
  return (
    <Card title="Thao tác sandbox">
      <div className="sbx-banner-warn" role="status" style={{ marginBottom: 12 }}>
        <span>
          <b>Đang bật sandbox…</b> — provider đang khởi tạo container, chờ vài giây rồi tải lại.
        </span>
      </div>
      <EmptyState title="Sandbox đang khởi tạo">
        Phiên sẽ tự chuyển sang “Đang chạy” sau khi container sẵn sàng.
      </EmptyState>
    </Card>
  );
}
