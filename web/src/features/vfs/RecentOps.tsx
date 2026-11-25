import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { formatTime } from "@/lib/format";
import type { OperationRow } from "./types";

/** Giờ ngắn gọn (HH:mm:ss) cho cột trái hẹp — giờ đầy đủ xem bằng tooltip. */
function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

interface RecentOpsProps {
  operations: OperationRow[];
  /** Số dòng tối đa hiển thị (mặc định 8 — phần còn lại xem ở trang Quản lý). */
  limit?: number;
  /** "Xem tất cả →" — mở tab Sổ thao tác ở trang Quản lý. */
  onViewAll: () => void;
}

/**
 * Sổ thao tác gần đây (compact) dưới cây file ở trang Thao tác:
 * giờ ngắn + hành động + badge trạng thái; chi tiết đầy đủ ở trang Quản lý.
 */
export function RecentOps({ operations, limit = 8, onViewAll }: RecentOpsProps) {
  const recent = operations.slice(0, limit);
  return (
    <Card
      title="Hoạt động gần đây"
      actions={
        <Button size="sm" variant="ghost" onClick={onViewAll} title="Mở Sổ thao tác ở trang Quản lý">
          Xem tất cả →
        </Button>
      }
    >
      {recent.length === 0 ? (
        <div className="vfs-dim vfs-small">Chưa có thao tác nào — ghi/xóa/sửa file sẽ được ghi sổ tại đây.</div>
      ) : (
        <div className="vfs-recent">
          {recent.map((op, index) => (
            <div key={`${op.created_at}:${index}`} className="vfs-recent-row" title={formatTime(op.created_at)}>
              <span className="vfs-recent-time">{shortTime(op.created_at)}</span>
              <span className="vfs-recent-type">
                {op.type}
                {op.sandbox_id ? <span className="vfs-dim"> · {op.sandbox_id.slice(0, 8)}</span> : null}
              </span>
              <Badge tone={op.status === "success" ? "green" : op.status === "failed" ? "red" : "yellow"}>
                {op.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
