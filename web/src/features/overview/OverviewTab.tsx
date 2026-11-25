/**
 * OverviewTab.tsx — dashboard tổng quan.
 * Nguồn dữ liệu: GET /admin/api/overview (workspace + thống kê DB dự án)
 * và GET /admin/api/sandboxes (phiên + sandbox thực tế). Tạo workspace qua
 * POST /admin/api/workspaces trong Modal.
 */

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { get, post } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";

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
        <div className="empty-state">
          <Spinner large label="Đang tải dữ liệu tổng quan…" />
        </div>
      </Card>
    );
  }

  if (error !== null || overview === null || stats === null) {
    return (
      <Card title="Tổng quan">
        <div className="ov-alert" role="alert">
          <strong>Không tải được dữ liệu tổng quan</strong>
          <span>{error ?? "Dữ liệu trống."}</span>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* ---- Hàng card thống kê ---- */}
      <div className="ov-stats">
        <Card>
          <div className="ov-stat-value">{stats.workspaceCount}</div>
          <div className="ov-stat-label">Workspace</div>
        </Card>
        <Card>
          <div className="ov-stat-value">{stats.sessionCount}</div>
          <div className="ov-stat-label">Phiên đã ghi sổ</div>
        </Card>
        <Card>
          <div className="ov-stat-value">{stats.runningCount}</div>
          <div className="ov-stat-label">Phiên đang RUNNING</div>
        </Card>
        <Card>
          <div className="ov-stat-value">{stats.sandboxActiveCount}</div>
          <div className="ov-stat-label">Sandbox đang bật</div>
        </Card>
        <Card>
          <div className="ov-stat-value">{formatBytes(stats.usedBytes)}</div>
          <div className="ov-stat-label">
            Dung lượng đã dùng / hạn mức {formatBytes(stats.quotaBytes)} mỗi workspace
          </div>
        </Card>
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
          <EmptyState title="Chưa có workspace nào" description="Bấm “Tạo workspace” để bắt đầu.">
            <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
              + Tạo workspace
            </Button>
          </EmptyState>
        ) : (
          <div className="ov-table-wrap">
            <table className="table">
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
                  <WorkspaceTr key={ws.id} ws={ws} />
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
          <Field label="Tên (tùy chọn — để trống sẽ sinh mã tự động)">
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="vd: demo-kho-van-ban"
            />
          </Field>
          <Field label="Chính sách xung đột" hint="sandbox_wins: sandbox đè kho khi đồng bộ; error: báo lỗi và dừng.">
            <select className="select" value={newPolicy} onChange={(e) => setNewPolicy(e.target.value)}>
              <option value="sandbox_wins">sandbox_wins</option>
              <option value="error">error</option>
            </select>
          </Field>
          {createError !== null ? (
            <div className="ov-alert" role="alert">
              {createError}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setModalOpen(false)}>Hủy</Button>
            <Button variant="primary" loading={creating} onClick={() => void handleCreate()}>
              Tạo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 1 dòng workspace — badge trạng thái phiên dựa trên session_id có mặt hay không. */
function WorkspaceTr({ ws }: { ws: WorkspaceRow }) {
  return (
    <tr>
      <td className="mono">{ws.id}</td>
      <td>{ws.name ?? "—"}</td>
      <td>{ws.missing_db ? <Badge tone="red" title="Không mở được DB dự án">thiếu DB</Badge> : (ws.revision ?? 0)}</td>
      <td>{ws.missing_db ? "—" : (ws.file_count ?? 0)}</td>
      <td>{ws.missing_db ? "—" : formatBytes(ws.used_bytes ?? 0)}</td>
      <td>
        {ws.session_id ? (
          <Badge tone="green" title={`session: ${ws.session_id}`}>
            có phiên
          </Badge>
        ) : (
          <Badge tone="gray">chưa có phiên</Badge>
        )}
      </td>
      <td>{formatTime(ws.created_at)}</td>
    </tr>
  );
}
