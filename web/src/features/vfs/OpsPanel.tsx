import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { formatTime } from "@/lib/format";
import type { OperationRow } from "./types";

/** Tab "Sổ thao tác": log thao tác gần đây của workspace (limit do server quyết định). */
export function OpsPanel({ operations }: { operations: OperationRow[] }) {
  if (operations.length === 0) {
    return <EmptyState title="Chưa có thao tác" description="Ghi/xóa/sửa file sẽ được ghi sổ tại đây." />;
  }
  return (
    <div className="vfs-tblwrap">
      <table className="table table-zebra">
        <thead>
          <tr>
            <th>giờ</th>
            <th>hành động</th>
            <th>trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((op, index) => (
            <tr key={`${op.created_at}:${index}`}>
              <td className="vfs-dim" style={{ whiteSpace: "nowrap" }}>{formatTime(op.created_at)}</td>
              <td>
                {op.type}
                {op.sandbox_id ? <span className="vfs-dim"> · {op.sandbox_id}</span> : null}
              </td>
              <td>
                <Badge tone={op.status === "success" ? "green" : op.status === "failed" ? "red" : "yellow"}>
                  {op.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
