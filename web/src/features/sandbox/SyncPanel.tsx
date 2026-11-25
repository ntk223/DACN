/**
 * SyncPanel.tsx — đồng bộ kho VFS → sandbox: badge trạng thái, đẩy thay đổi,
 * đẩy lại toàn bộ, so sánh sha256 từng file (4 nhóm: khớp / khác / chỉ kho / chỉ sandbox).
 */
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { sandboxApi } from "./sandboxApi";
import { SyncBadge } from "./SandboxTable";
import type { CompareResult, SessionRow, SyncResult } from "./types";

interface SyncPanelProps {
  /** Phiên RUNNING của sandbox đang chọn (sync yêu cầu RUNNING). */
  session: SessionRow | null;
  onChanged: () => void;
  notify: (message: string, kind?: "ok" | "err" | "warn") => void;
}

export function SyncPanel({ session, onChanged, notify }: SyncPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState<CompareResult | null>(null);

  const sessionId = session?.session_id ?? null;
  const running = session !== null;

  const doSync = async (full: boolean) => {
    if (!sessionId || syncing) return;
    setSyncing(true);
    try {
      const result: SyncResult = await sandboxApi.sync(sessionId, full);
      notify(
        result.skipped
          ? "Đồng bộ: không có gì mới"
          : `Đồng bộ${full ? " toàn bộ" : ""}: đẩy ${result.put ?? 0} file, xóa ${result.deleted ?? 0}`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Đồng bộ thất bại", "err");
    } finally {
      setSyncing(false);
      onChanged();
    }
  };

  const doCompare = async () => {
    if (!sessionId || comparing) return;
    setComparing(true);
    try {
      setCompare(await sandboxApi.compare(sessionId));
    } catch (error) {
      notify(error instanceof Error ? error.message : "So sánh thất bại", "err");
      setCompare(null);
    } finally {
      setComparing(false);
    }
  };

  return (
    <Card title="Đồng bộ kho → sandbox">
      <div className="sbx-badges" style={{ marginBottom: 12 }}>
        <span className="sbx-meta">Trạng thái:</span>
        {session?.sync ? <SyncBadge sync={session.sync} /> : <Badge>—</Badge>}
        {!running ? <span className="sbx-meta">chỉ khả dụng khi sandbox RUNNING.</span> : null}
      </div>

      <div className="sbx-toolbar">
        <Button size="sm" variant="primary" disabled={!running} loading={syncing} onClick={() => void doSync(false)}>
          Đồng bộ ngay
        </Button>
        <Button size="sm" disabled={!running} loading={syncing} onClick={() => void doSync(true)}>
          Đồng bộ lại toàn bộ
        </Button>
        <Button size="sm" disabled={!running} loading={comparing} onClick={() => void doCompare()}>
          So sánh kho ↔ sandbox
        </Button>
      </div>

      {compare !== null ? <CompareTable data={compare} /> : null}
    </Card>
  );
}

function CompareTable({ data }: { data: CompareResult }) {
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sbx-badges">
        {data.in_sync ? <Badge tone="green">KHỚP</Badge> : <Badge tone="yellow">LỆCH</Badge>}
        <Badge title="Revision kho VFS">kho rev {data.revision ?? "?"}</Badge>
        <Badge title="Revision sandbox đã nhận">sandbox rev {data.watermark ?? "?"}</Badge>
        <Badge tone={data.status === "synced" ? "green" : "yellow"}>{data.status ?? "?"}</Badge>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Nhóm</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><Badge tone="green">khớp</Badge></td>
            <td className="sbx-meta">{data.same} file trùng sha256</td>
          </tr>
          {data.differ.map((d) => (
            <tr key={`differ-${d.path}`}>
              <td><Badge tone="yellow">khác nội dung</Badge></td>
              <td className="sbx-compare-path">
                {d.path}
                <span className="sbx-meta"> · kho {d.vfs_sha256.slice(0, 8)} ↔ sandbox {d.sandbox_sha256.slice(0, 8)}</span>
              </td>
            </tr>
          ))}
          {data.only_vfs.map((path) => (
            <tr key={`vfs-${path}`}>
              <td><Badge tone="yellow">chỉ có trong kho</Badge></td>
              <td className="sbx-compare-path">{path}</td>
            </tr>
          ))}
          {data.only_sandbox.map((entry) => (
            <tr key={`sbx-${entry.path}`}>
              <td><Badge>chỉ có trong sandbox</Badge></td>
              <td className="sbx-compare-path">
                {entry.path}
                <span className="sbx-meta"> · chưa nhận về kho</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
