/**
 * SyncPanel.tsx — đồng bộ hai chiều: đẩy kho VFS → sandbox (sync ngay / toàn bộ),
 * nhận thay đổi sandbox → kho (pull-back), so sánh sha256 từng file
 * (4 nhóm: khớp / khác / chỉ kho / chỉ sandbox).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { IconArrowDown } from "@/components/icons";
import type { ToastKind } from "@/components/Toast";
import { formatBytes } from "@/lib/format";
import { sandboxApi } from "./sandboxApi";
import { SyncBadge } from "./SandboxTable";
import type { CompareResult, PullSummary, SessionRow, SyncResult } from "./types";

interface SyncPanelProps {
  /** Phiên RUNNING của sandbox đang chọn (sync yêu cầu RUNNING). */
  session: SessionRow | null;
  onChanged: () => void;
  notify: (message: string, kind?: ToastKind) => void;
}

export function SyncPanel({ session, onChanged, notify }: SyncPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [pullResult, setPullResult] = useState<PullSummary | null>(null);

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
      notify(error instanceof Error ? error.message : "Đồng bộ thất bại", "error");
    } finally {
      setSyncing(false);
      onChanged();
    }
  };

  const doPull = async () => {
    if (!sessionId || pulling) return;
    setPulling(true);
    try {
      const result = await sandboxApi.pull(sessionId);
      setPullResult(result);
      const applied = result.applied?.length ?? 0;
      const conflicts = result.conflicts?.length ?? 0;
      const failures = result.failures?.length ?? 0;
      notify(
        applied === 0 && conflicts === 0 && failures === 0
          ? "Nhận về kho: không có thay đổi mới trong sandbox"
          : `Nhận về kho: nhận ${applied} file` +
              (conflicts > 0 ? `, ${conflicts} xung đột` : "") +
              (failures > 0 ? `, ${failures} lỗi` : ""),
        conflicts > 0 || failures > 0 ? "warn" : "success",
      );
      // Làm mới panel: so sánh lại kho ↔ sandbox sau khi đã nhận về.
      try {
        setCompare(await sandboxApi.compare(sessionId));
      } catch {
        setCompare(null);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Nhận về kho thất bại", "error");
    } finally {
      setPulling(false);
      onChanged();
    }
  };

  const doCompare = async () => {
    if (!sessionId || comparing) return;
    setComparing(true);
    try {
      setCompare(await sandboxApi.compare(sessionId));
    } catch (error) {
      notify(error instanceof Error ? error.message : "So sánh thất bại", "error");
      setCompare(null);
    } finally {
      setComparing(false);
    }
  };

  return (
    <Card title="Đồng bộ kho ↔ sandbox">
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
        <Button
          size="sm"
          disabled={!running}
          loading={pulling}
          title="Nhận về kho các thay đổi agent tạo trong sandbox (pull-back)"
          onClick={() => void doPull()}
        >
          <IconArrowDown size={16} />
          Nhận về kho
        </Button>
        <Button size="sm" disabled={!running} loading={comparing} onClick={() => void doCompare()}>
          So sánh kho ↔ sandbox
        </Button>
      </div>

      {pullResult !== null ? <PullResultView data={pullResult} /> : null}
      {compare !== null ? <CompareTable data={compare} /> : null}
    </Card>
  );
}

/** Kết quả lần pull gần nhất: badge tổng hợp + bảng xung đột / lỗi (nếu có). */
function PullResultView({ data }: { data: PullSummary }) {
  const applied = data.applied ?? [];
  const conflicts = data.conflicts ?? [];
  const failures = data.failures ?? [];
  const trouble = conflicts.length > 0 || failures.length > 0;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sbx-badges">
        <Badge tone={trouble ? "yellow" : "green"}>đã nhận {applied.length}</Badge>
        <Badge title="Số file quét trong /workspace">quét {data.pulled ?? "?"}</Badge>
        {conflicts.length > 0 ? <Badge tone="yellow">xung đột {conflicts.length}</Badge> : null}
        {failures.length > 0 ? <Badge tone="red">lỗi {failures.length}</Badge> : null}
        {data.bytes !== undefined ? (
          <span className="sbx-meta">{formatBytes(data.bytes)} · {data.duration_ms ?? "?"} ms</span>
        ) : null}
      </div>

      {trouble ? (
        <div className="sbx-tblwrap">
          <table className="table">
            <thead>
              <tr>
                <th>Loại</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={`conflict-${c.path}`}>
                  <td>
                    <Badge tone="yellow">xung đột {c.kind ?? ""}</Badge>
                  </td>
                  <td>
                    <span className="sbx-compare-path">{c.path}</span>
                    <span className="sbx-meta">
                      {" "}· sandbox {c.sandbox_sha256?.slice(0, 8) ?? "?"} ↔ kho {c.vfs_sha256?.slice(0, 8) ?? "?"}
                    </span>
                  </td>
                </tr>
              ))}
              {failures.map((f) => (
                <tr key={`failure-${f.path}`}>
                  <td>
                    <Badge tone="red">lỗi nhận</Badge>
                  </td>
                  <td>
                    <span className="sbx-compare-path">{f.path}</span>
                    {f.error ? <span className="sbx-meta"> · {f.error}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Một nhóm kết quả so sánh: tiêu đề + count + các dòng file. */
interface CompareGroup {
  key: string;
  badge: ReactNode;
  title: string;
  /** Số mục của nhóm — mặc định bằng số hàng hiển thị. */
  count?: number;
  /** File rơi vào nhóm — mỗi phần tử là nội dung ô "File". */
  rows: ReactNode[];
}

function CompareTable({ data }: { data: CompareResult }) {
  const sameRows: ReactNode[] =
    data.same > 0
      ? [<span className="sbx-meta" key="same-all">{data.same} file trùng sha256 — liệt kê rút gọn.</span>]
      : [];
  const groups: CompareGroup[] = [
    {
      key: "same",
      badge: <Badge tone="green">khớp</Badge>,
      title: "Trùng sha256 kho ↔ sandbox",
      count: data.same,
      rows: sameRows,
    },
    {
      key: "differ",
      badge: <Badge tone="yellow">khác nội dung</Badge>,
      title: "Có ở cả hai nhưng sha256 khác — cần đồng bộ",
      rows: data.differ.map((d) => (
        <span className="sbx-compare-path" key={`differ-${d.path}`}>
          {d.path}
          <span className="sbx-meta"> · kho {d.vfs_sha256.slice(0, 8)} ↔ sandbox {d.sandbox_sha256.slice(0, 8)}</span>
        </span>
      )),
    },
    {
      key: "only_vfs",
      badge: <Badge tone="yellow">chỉ có trong kho</Badge>,
      title: "Chỉ có trong kho VFS — chưa đẩy sang sandbox",
      rows: data.only_vfs.map((path) => (
        <span className="sbx-compare-path" key={`vfs-${path}`}>{path}</span>
      )),
    },
    {
      key: "only_sandbox",
      badge: <Badge>chỉ có trong sandbox</Badge>,
      title: "Chỉ có trong sandbox — chưa nhận về kho",
      rows: data.only_sandbox.map((entry) => (
        <span className="sbx-compare-path" key={`sbx-${entry.path}`}>
          {entry.path}
          <span className="sbx-meta"> · chưa nhận về kho</span>
        </span>
      )),
    },
  ];

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sbx-badges">
        {data.in_sync ? <Badge tone="green">KHỚP</Badge> : <Badge tone="yellow">LỆCH</Badge>}
        <Badge title="Revision kho VFS">kho rev {data.revision ?? "?"}</Badge>
        <Badge title="Revision sandbox đã nhận">sandbox rev {data.watermark ?? "?"}</Badge>
        <Badge tone={data.status === "synced" ? "green" : "yellow"}>{data.status ?? "?"}</Badge>
      </div>

      <div className="sbx-tblwrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nhóm</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <FragmentRows key={group.key} group={group} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Hàng tiêu đề nhóm (badge + tên + count) và các hàng file của nhóm. */
function FragmentRows({ group }: { group: CompareGroup }) {
  return (
    <>
      <tr className="sbx-group-row">
        <td>
          <span className="sbx-badges">
            {group.badge}
            <span>{group.title}</span>
            <Badge title={`Số mục trong nhóm “${group.title}”`}>{group.count ?? group.rows.length}</Badge>
          </span>
        </td>
        <td />
      </tr>
      {group.rows.length === 0 ? (
        <tr>
          <td colSpan={2}>
            <span className="sbx-meta">Không có mục nào.</span>
          </td>
        </tr>
      ) : (
        group.rows.map((row, index) => (
          <tr key={`${group.key}-${index}`}>
            <td />
            <td>{row}</td>
          </tr>
        ))
      )}
    </>
  );
}
