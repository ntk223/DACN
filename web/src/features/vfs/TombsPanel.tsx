import { EmptyState } from "@/components/EmptyState";
import type { Tombstone } from "./types";

/** Tab "Dấu xóa": danh sách tombstone (file đã xóa, nguồn xóa, sha thời điểm xóa). */
export function TombsPanel({ tombstones }: { tombstones: Tombstone[] }) {
  if (tombstones.length === 0) {
    return <EmptyState title="Không có dấu xóa" description="File bị xóa sẽ để lại một dòng ở đây." />;
  }
  return (
    <div className="vfs-tblwrap">
      <table className="table table-zebra">
        <thead>
          <tr>
            <th>path</th>
            <th>rev</th>
            <th>origin</th>
            <th>sha</th>
          </tr>
        </thead>
        <tbody>
          {tombstones.map((t) => (
            <tr key={`${t.path}:${t.rev}`}>
              <td className="mono">{t.path}</td>
              <td>{t.rev}</td>
              <td>{t.origin}</td>
              <td className="mono vfs-dim">{t.sha256.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
