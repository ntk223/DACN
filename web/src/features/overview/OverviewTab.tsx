/**
 * OverviewTab.tsx — dashboard tổng quan.
 * Nguồn dữ liệu: GET /admin/api/overview (workspace + thống kê DB dự án)
 * và GET /admin/api/sandboxes (phiên + sandbox thực tế). Tạo workspace qua
 * POST /admin/api/workspaces trong Modal.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { get, post } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";

import { IconBox, IconClock, IconDatabase, IconErrorCircle, IconFolder, IconPlay } from "./icons";
import { OvLoading, OvState } from "./states";
import type { CreateWorkspaceResponse, OverviewResponse, SandboxOverviewResponse, WorkspaceRow } from "./types";

interface Stats {
  workspaceCount: number;
  sessionCount: number;
  runningCount: number;
  sandboxActiveCount: number;
  usedBytes: number;
  quotaBytes: number;
  inlineMaxBytes: number;
}

/** Gộp 2 nguồn dữ liệu thành các con số thống kê. */
function computeStats(overview: OverviewResponse, sandboxes: SandboxOverviewResponse | null): Stats {
  const usedBytes = overview.workspaces.reduce((sum, ws) => sum + (ws.used_bytes ?? 0), 0);
  const sessions = sandboxes?.sessions ?? [];
  return {
    workspaceCount: overview.workspaces.length,
    sessionCount: sessions.length,
    runningCount: sessions.filter((s) => s.state === "RUNNING").length,
    sandboxActiveCount: sessions.filter(
      (s) => s.sandbox_id && (s.state === "RUNNING" || s.state === "PAUSED" || s.state === "STARTING"),
    ).length,
    usedBytes,
    quotaBytes: overview.settings.workspace_quota_bytes,
    inlineMaxBytes: overview.settings.inline_max_bytes,
  };
}

/** Map session_id → state (RUNNING/STANDBY/…) để badge trong bảng workspace. */
function buildSessionStates(sandboxes: SandboxOverviewResponse | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const session of sandboxes?.sessions ?? []) {
    map.set(session.session_id, session.state);
  }
  return map;
}

export function OverviewTab() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [sandboxes, setSandboxes] = useState<SandboxOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Modal tạo workspace
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPolicy, setNewPolicy] = useState("sandbox_wins");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // Hai endpoint độc lập — chạy song song, hủy khi unmount.
    const overviewPromise = get<OverviewResponse>("/admin/api/overview", { signal: controller.signal });
    const sandboxPromise = get<SandboxOverviewResponse>("/admin/api/sandboxes", { signal: controller.signal });
    Promise.all([overviewPromise, sandboxPromise])
      .then(([ov, sb]) => {
        setOverview(ov);
        setSandboxes(sb);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [tick]);

  const stats = useMemo(
    () => (overview ? computeStats(overview, sandboxes) : null),
    [overview, sandboxes],
  );
  const sessionStates = useMemo(() => buildSessionStates(sandboxes), [sandboxes]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      await post<CreateWorkspaceResponse>("/admin/api/workspaces", {
        name: newName.trim(),
        conflict_policy: newPolicy,
      });
      setModalOpen(false);
      setNewName("");
      setTick((t) => t + 1); // nạp lại dashboard
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <Card title="Tổng quan">
        <OvLoading
          title="Đang tải dữ liệu tổng quan…"
          description="Đang lấy danh sách workspace, phiên và thống kê DB dự án."
        />
      </Card>
    );
  }

  if (error !== null || overview === null || stats === null) {
    return (
      <Card title="Tổng quan">
        <div className="ov-alert" role="alert">
          <IconErrorCircle />
          <div className="ov-alert-body">
            <strong>Không tải được dữ liệu tổng quan</strong>
            <span>{error ?? "Dữ liệu trống."}</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="ov-sections">
      {/* ---- Hàng card thống kê ---- */}
      <div className="ov-stats">
        <StatCard icon={<IconFolder />} value={String(stats.workspaceCount)} label="Workspace" />
        <StatCard icon={<IconClock />} value={String(stats.sessionCount)} label="Phiên đã ghi sổ" />
        <StatCard icon={<IconPlay />} value={String(stats.runningCount)} label="Phiên đang RUNNING" />
        <StatCard icon={<IconBox />} value={String(stats.sandboxActiveCount)} label="Sandbox đang bật" />
        <StatCard
          icon={<IconDatabase />}
          value={formatBytes(stats.usedBytes)}
          label="Dung lượng đã dùng"
          sub={`Hạn mức ${formatBytes(stats.quotaBytes)} / workspace · inline ≤ ${formatBytes(stats.inlineMaxBytes)}`}
        />
      </div>

      {/* ---- Danh sách workspace ---- */}
      <Card
        title="Workspace gần đây"
        actions={
          <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
            + Tạo workspace
          </Button>
        }
      >
        {overview.workspaces.length === 0 ? (
          <OvState title="Chưa có workspace nào" description="Bấm “Tạo workspace” để bắt đầu.">
            <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
              + Tạo workspace
            </Button>
          </OvState>
        ) : (
          <div className="ov-table-wrap">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Nhãn</th>
                  <th>Revision</th>
                  <th>File</th>
                  <th>Dung lượng</th>
                  <th>Phiên</th>
                  <th>Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {overview.workspaces.map((ws) => (
                  <WorkspaceTr key={ws.id} ws={ws} sessionStates={sessionStates} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- Ngưỡng cấu hình ---- */}
      <Card title="Ngưỡng cấu hình">
        <div className="ov-form-desc">
          Thư mục dữ liệu: <code>{overview.settings.data_dir}</code>
        </div>
        <div className="ov-form-desc">
          Inline ≤ {formatBytes(stats.inlineMaxBytes)} · file rời (blob) từ{" "}
          {formatBytes(overview.settings.blob_sidecar_min_bytes)} · tối đa{" "}
          {overview.settings.max_revisions_per_file} bản lịch sử mỗi file
        </div>
      </Card>

      {/* ---- Modal tạo workspace ---- */}
      <Modal open={modalOpen} title="Tạo workspace mới" onClose={() => setModalOpen(false)}>
        <div className="ov-form">
          <Field label="Tên workspace (tùy chọn)" hint="Để trống hệ thống sẽ sinh mã tự động.">
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="vd: demo-kho-van-ban"
              autoFocus
            />
          </Field>
          <Field
            label="Chính sách xung đột"
            hint="sandbox_wins: sandbox đè kho khi đồng bộ; error: báo lỗi và dừng."
          >
            <select className="select" value={newPolicy} onChange={(e) => setNewPolicy(e.target.value)}>
              <option value="sandbox_wins">sandbox_wins</option>
              <option value="error">error</option>
            </select>
          </Field>
          {createError !== null ? (
            <div className="ov-alert" role="alert">
              <IconErrorCircle />
              <div className="ov-alert-body">
                <strong>Tạo workspace thất bại</strong>
                <span>{createError}</span>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <Button onClick={() => setModalOpen(false)}>Hủy</Button>
            <Button variant="primary" loading={creating} onClick={() => void handleCreate()}>
              Tạo workspace
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 1 card thống kê: icon minh họa + số liệu to 28px/700 + nhãn 13px uppercase. */
function StatCard({
  icon,
  value,
  label,
  sub,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <Card className="ov-stat-card">
      <div className="ov-stat-top">
        <span className="ov-stat-icon">{icon}</span>
      </div>
      <div className="ov-stat-value">{value}</div>
      <div className="ov-stat-label">{label}</div>
      {sub !== undefined ? <div className="ov-stat-sub">{sub}</div> : null}
    </Card>
  );
}

/** Badge trạng thái phiên theo state thật: RUNNING xanh / STARTING-PAUSED vàng / còn lại xám. */
function SessionStateBadge({ state, sessionId }: { state: string | undefined; sessionId: string }) {
  if (state === undefined) {
    return (
      <Badge tone="gray" title={`session: ${sessionId}`}>
        chưa có phiên
      </Badge>
    );
  }
  const tone = state === "RUNNING" ? "green" : state === "STARTING" || state === "PAUSED" ? "yellow" : "gray";
  return (
    <Badge tone={tone} title={`session: ${sessionId}`}>
      {state}
    </Badge>
  );
}

/** 1 dòng workspace — badge trạng thái phiên dựa trên state từ /admin/api/sandboxes. */
function WorkspaceTr({ ws, sessionStates }: { ws: WorkspaceRow; sessionStates: Map<string, string> }) {
  const state = ws.session_id !== undefined && ws.session_id !== null ? sessionStates.get(ws.session_id) : undefined;
  return (
    <tr>
      <td className="mono">{ws.id}</td>
      <td>{ws.name ?? "—"}</td>
      <td>{ws.missing_db ? <Badge tone="red" title="Không mở được DB dự án">thiếu DB</Badge> : (ws.revision ?? 0)}</td>
      <td>{ws.missing_db ? "—" : (ws.file_count ?? 0)}</td>
      <td>{ws.missing_db ? "—" : formatBytes(ws.used_bytes ?? 0)}</td>
      <td>
        {ws.session_id ? (
          <SessionStateBadge state={state} sessionId={ws.session_id} />
        ) : (
          <Badge tone="gray">chưa có phiên</Badge>
        )}
      </td>
      <td>{formatTime(ws.created_at)}</td>
    </tr>
  );
}
