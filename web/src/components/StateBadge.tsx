/**
 * StateBadge.tsx — badge trạng thái phiên/sandbox dùng chung.
 * Gộp 6 chỗ map state → badge đang lặp lại trong feature (SandboxTable,
 * SandboxOpsPage, OverviewTab, ConsoleTab, WorkspaceInfoBar, SandboxDetail).
 * tone: RUNNING xanh / STARTING·PAUSED·DRIFT vàng / ERROR đỏ / còn lại xám.
 */
import { Badge } from "@/components/Badge";

type Tone = "green" | "yellow" | "red" | "gray";

interface StateMeta {
  tone: Tone;
  label: string;
  hint: string;
}

/** Superset nhãn tiếng Việt + tone + tooltip cho mọi trạng thái ghi sổ. */
const STATE_META: Record<string, StateMeta> = {
  RUNNING: {
    tone: "green",
    label: "Đang chạy",
    hint: "Sandbox đang chạy.",
  },
  STARTING: {
    tone: "gray",
    label: "Đang bật",
    hint: "Provider đang khởi tạo container, chờ vài giây rồi tải lại.",
  },
  PAUSED: {
    tone: "yellow",
    label: "Tạm dừng",
    hint: "Container bị pause — tiếp tục để chạy lại.",
  },
  STANDBY: {
    tone: "gray",
    label: "Chờ bật",
    hint: "Phiên chưa có sandbox — bật ở trang Thao tác.",
  },
  DRIFT: {
    tone: "yellow",
    label: "Lệch sổ",
    hint: "Trạng thái ghi sổ khác với thực tế của provider — kiểm tra lại phiên.",
  },
  ERROR: {
    tone: "red",
    label: "Lỗi",
    hint: "Sandbox gặp lỗi — xem log chi tiết.",
  },
};

/** Trạng thái lạ (không trong bảng) → xám, hiển thị mã gốc. */
const UNKNOWN_META: StateMeta = {
  tone: "gray",
  label: "",
  hint: "Trạng thái ghi sổ",
};

export interface StateBadgeProps {
  /** Mã trạng thái ghi sổ (RUNNING, PAUSED, STANDBY, STARTING, DRIFT, ERROR…). */
  state: string;
  /** Ghi đè nhãn hiển thị (mặc định: nhãn tiếng Việt theo bảng trên). */
  label?: string;
}

/** Badge trạng thái có chấm tròn trước chữ; dùng thay cho mọi map state→badge cục bộ. */
export function StateBadge({ state, label }: StateBadgeProps) {
  const meta = STATE_META[state] ?? { ...UNKNOWN_META, label: state };
  return (
    <Badge tone={meta.tone} title={meta.hint}>
      <span className="badge-dot" aria-hidden="true" />
      {label ?? meta.label}
    </Badge>
  );
}
