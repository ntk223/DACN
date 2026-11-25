/**
 * SandboxTable.tsx — bảng phiên làm việc + sandbox mồ côi + modal Bật/Gia hạn.
 * Mọi thao tác vòng đời đi qua Manager (POST /sessions/{id}/...) như tool MCP.
 */
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { sandboxApi } from "./sandboxApi";
import type {
  OrphanRow,
  ProviderCapabilities,
  SessionRow,
  StartResult,
} from "./types";
import { limitsLabel, remainLabel, timeLabel } from "./util";

type Notify = (message: string, kind?: "ok" | "err" | "warn") => void;

interface SandboxTableProps {
  sessions: SessionRow[];
  orphans: OrphanRow[];
  capabilities: ProviderCapabilities;
  selectedId: string | null;
  onSelect: (sandboxId: string) => void;
  /** Báo trang tạm dừng auto-refresh khi modal mở. */
  onModalOpenChange: (open: boolean) => void;
  /** Gọi lại sau mỗi thao tác thành công để tải dữ liệu mới. */
  onChanged: () => void;
  notify: Notify;
}

/** Badge tone theo trạng thái ghi sổ (DB). */
function stateTone(state: string): "green" | "yellow" | "gray" {
  if (state === "RUNNING") return "green";
  if (state === "PAUSED") return "yellow";
  return "gray";
}

/** Badge tone theo trạng thái thật của provider (Docker). */
function providerTone(state: string | null | undefined): "green" | "yellow" | "red" {
  if (state === "running") return "green";
  if (state === "paused") return "yellow";
  return "red";
}

export function SandboxTable({
  sessions,
  orphans,
  capabilities,
  selectedId,
  onSelect,
  onModalOpenChange,
  onChanged,
  notify,
}: SandboxTableProps) {
  const [busySession, setBusySession] = useState<string | null>(null);
  const [startTarget, setStartTarget] = useState<SessionRow | null>(null);
  const [renewTarget, setRenewTarget] = useState<SessionRow | null>(null);

  const liveCount = sessions.filter(
    (s) => s.state === "RUNNING" || s.state === "PAUSED",
  ).length;

  const openModal = (setter: (row: SessionRow | null) => void, row: SessionRow) => {
    setter(row);
    onModalOpenChange(true);
  };

  const closeModal = (setter: (row: SessionRow | null) => void) => {
    setter(null);
    onModalOpenChange(false);
  };

  /** Chạy một thao tác vòng đời (pause/resume/stop) — bễ cờ busy tránh bấm đôi. */
  const runLifecycle = async (
    row: SessionRow,
    action: "pause" | "resume" | "stop",
  ) => {
    if (busySession) return;
    setBusySession(row.session_id);
    try {
      if (action === "pause") await sandboxApi.pause(row.session_id);
      else if (action === "resume") await sandboxApi.resume(row.session_id);
      else await sandboxApi.stop(row.session_id);
      notify(
        action === "stop" ? "Đã dừng — sandbox và volume đã xóa" : `Phiên → ${action === "pause" ? "tạm dừng" : "chạy lại"}`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Thao tác thất bại", "err");
    } finally {
      setBusySession(null);
      onChanged();
    }
  };

  const removeOrphan = async (orphan: OrphanRow) => {
    if (
      !window.confirm(`Xóa sandbox ${orphan.sandbox_id} và volume của nó?`)
    ) {
      return;
    }
    try {
      await sandboxApi.deleteOrphan(orphan.sandbox_id);
      notify(`Đã dọn ${orphan.sandbox_id}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dọn thất bại", "err");
    }
    onChanged();
  };

  return (
    <div className="sbx-col">
      <Card
        title="Phiên làm việc"
        actions={<span className="sbx-meta">{sessions.length} phiên · {liveCount} đang có sandbox</span>}
      >
        {sessions.length === 0 ? (
          <EmptyState title="Chưa có phiên nào">
            Tạo workspace ở trang Quản lý VFS để bắt đầu.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table sbx-table">
              <thead>
                <tr>
                  <th>Phiên</th>
                  <th>Trạng thái</th>
                  <th>TTL</th>
                  <th>Đồng bộ</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((row) => {
                  const live =
                    (row.state === "RUNNING" || row.state === "PAUSED") && row.sandbox_id;
                  const selectable = Boolean(live);
                  return (
                    <tr
                      key={row.session_id}
                      className={row.sandbox_id && row.sandbox_id === selectedId ? "sbx-selected" : ""}
                      onClick={selectable ? () => onSelect(row.sandbox_id as string) : undefined}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.workspace_name ?? row.workspace_id}</div>
                        <div className="sbx-meta sbx-mono">
                          ws {row.workspace_id} · phiên {row.session_id.slice(0, 12)}…
                        </div>
                      </td>
                      <td>
                        <div className="sbx-badges">
                          <Badge tone={stateTone(row.state)}>{row.state}</Badge>
                          {live ? (
                            <Badge tone={providerTone(row.provider_state)} title="Trạng thái thật theo provider">
                              thực tế: {row.provider_state ?? "mất"}
                            </Badge>
                          ) : null}
                          {row.drift ? (
                            <Badge tone="red" title="Trạng thái ghi sổ khác thực tế của provider">
                              lệch sổ
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="sbx-meta">{live ? remainLabel(row.expires_at) : "—"}</td>
                      <td>{live && row.sync ? <SyncBadge sync={row.sync} /> : <span className="sbx-meta">—</span>}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="sbx-badges">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={row.state !== "STANDBY" || busySession !== null}
                            onClick={() => openModal(setStartTarget, row)}
                          >
                            Bật
                          </Button>
                          <Button
                            size="sm"
                            disabled={row.state !== "RUNNING" || busySession !== null || capabilities.pause_resume === false}
                            onClick={() => void runLifecycle(row, "pause")}
                          >
                            Tạm dừng
                          </Button>
                          <Button
                            size="sm"
                            disabled={row.state !== "PAUSED" || busySession !== null}
                            onClick={() => void runLifecycle(row, "resume")}
                          >
                            Tiếp tục
                          </Button>
                          <Button
                            size="sm"
                            disabled={!live || busySession !== null}
                            onClick={() => openModal(setRenewTarget, row)}
                          >
                            Gia hạn
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={!live || busySession !== null}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Dừng phiên và XÓA sandbox ${row.sandbox_id} cùng volume? (File trong kho VFS không mất.)`,
                                )
                              ) {
                                void runLifecycle(row, "stop");
                              }
                            }}
                          >
                            Dừng &amp; xóa
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Sandbox mồ côi"
        actions={<span className="sbx-meta">provider còn giữ, không phiên nào dùng</span>}
      >
        {orphans.length === 0 ? (
          <EmptyState title="Không có sandbox mồ côi" />
        ) : (
          <div className="sbx-col">
            {orphans.map((orphan) => (
              <div
                key={orphan.sandbox_id}
                className={`sbx-orphan${orphan.sandbox_id === selectedId ? " sbx-orphan-active" : ""}`}
                onClick={() => onSelect(orphan.sandbox_id)}
              >
                <div className="sbx-badges">
                  <span className="sbx-mono" style={{ fontWeight: 600 }}>{orphan.sandbox_id}</span>
                  {orphan.state ? <Badge tone={providerTone(orphan.state)}>{orphan.state}</Badge> : null}
                </div>
                <div className="sbx-meta">
                  phiên {orphan.session_id ?? "?"} · tạo {timeLabel(orphan.created_at)}
                </div>
                <div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeOrphan(orphan);
                    }}
                  >
                    Dọn sandbox + volume
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modal Bật sandbox: TTL phút + CPU + RAM */}
      <StartModal
        row={startTarget}
        onClose={() => closeModal(setStartTarget)}
        onDone={(result) => {
          closeModal(setStartTarget);
          notify(`Đã bật ${result.sandbox_id} · nạp ${result.materialized_files ?? 0} file`);
          if (result.sandbox_id) onSelect(result.sandbox_id);
          onChanged();
        }}
        notify={notify}
      />

      {/* Modal Gia hạn: hỏi số phút */}
      <RenewModal
        row={renewTarget}
        onClose={() => closeModal(setRenewTarget)}
        onDone={() => {
          closeModal(setRenewTarget);
          notify("Đã gia hạn phiên");
          onChanged();
        }}
        notify={notify}
      />
    </div>
  );
}

/** Badge trạng thái đồng bộ (dùng trong bảng và tab Đồng bộ). */
export function SyncBadge({ sync }: { sync: NonNullable<SessionRow["sync"]> }) {
  if (sync.status === "stale") {
    return <Badge tone="red">lỗi — chờ đẩy lại ({sync.pending_push ?? 0})</Badge>;
  }
  if ((sync.pending_push ?? 0) > 0) {
    return (
      <Badge tone="yellow">
        chờ đẩy {sync.pending_put ?? 0} file, {sync.pending_delete ?? 0} xóa
      </Badge>
    );
  }
  return <Badge tone="green">đã khớp · rev {sync.synced_revision ?? "?"}</Badge>;
}

interface StartModalProps {
  row: SessionRow | null;
  onClose: () => void;
  onDone: (result: StartResult) => void;
  notify: Notify;
}

function StartModal({ row, onClose, onDone, notify }: StartModalProps) {
  const [ttlMinutes, setTtlMinutes] = useState("60");
  const [cpu, setCpu] = useState("");
  const [memoryMb, setMemoryMb] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!row) return;
    const ttl = Math.max(1, Math.round(Number(ttlMinutes) * 60));
    const cpuValue = Number(cpu);
    const memValue = Number(memoryMb);
    setBusy(true);
    try {
      const result = await sandboxApi.start(row.session_id, {
        ttl_seconds: Number.isFinite(ttl) ? ttl : 3600,
        cpu: cpu.trim() && Number.isFinite(cpuValue) && cpuValue > 0 ? cpuValue : null,
        memory: memoryMb.trim() && Number.isFinite(memValue) && memValue > 0 ? memValue : null,
      });
      onDone(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Bật sandbox thất bại", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={row !== null} title={`Bật sandbox — ${row?.workspace_name ?? row?.workspace_id ?? ""}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="TTL (phút)" hint="Hết hạn Sandbox tự dừng sau khoảng này.">
          <input
            className="input"
            type="number"
            min={1}
            value={ttlMinutes}
            onChange={(event) => setTtlMinutes(event.target.value)}
          />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="CPU (core)" hint="Bỏ trống = không giới hạn.">
            <input
              className="input"
              type="number"
              step="0.5"
              min="0"
              placeholder="không giới hạn"
              value={cpu}
              onChange={(event) => setCpu(event.target.value)}
            />
          </Field>
          <Field label="RAM (MB)" hint="Bỏ trống = không giới hạn.">
            <input
              className="input"
              type="number"
              step="128"
              min="0"
              placeholder="không giới hạn"
              value={memoryMb}
              onChange={(event) => setMemoryMb(event.target.value)}
            />
          </Field>
        </div>
        <div className="sbx-toolbar">
          <span className="sbx-meta">{limitsLabel(Number(cpu) || null, Number(memoryMb) || null)}</span>
          <span className="spacer" />
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Bật sandbox
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface RenewModalProps {
  row: SessionRow | null;
  onClose: () => void;
  onDone: () => void;
  notify: Notify;
}

function RenewModal({ row, onClose, onDone, notify }: RenewModalProps) {
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!row) return;
    const ttl = Math.max(1, Math.round(Number(minutes) * 60));
    if (!Number.isFinite(ttl)) {
      notify("Số phút không hợp lệ", "warn");
      return;
    }
    setBusy(true);
    try {
      await sandboxApi.renew(row.session_id, ttl);
      onDone();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gia hạn thất bại", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={row !== null} title={`Gia hạn — ${row?.workspace_name ?? row?.workspace_id ?? ""}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Số phút gia hạn thêm">
          <input
            className="input"
            type="number"
            min={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </Field>
        <div className="sbx-toolbar">
          <span className="sbx-meta">Hiện {remainLabel(row?.expires_at)}</span>
          <span className="spacer" />
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Gia hạn
          </Button>
        </div>
      </div>
    </Modal>
  );
}
