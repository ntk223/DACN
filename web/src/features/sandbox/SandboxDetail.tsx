/**
 * SandboxDetail.tsx — chi tiết container của sandbox đang chọn: thông tin,
 * số liệu CPU/RAM, và các tab Chạy lệnh / Kiểm tra lệnh / Đồng bộ / File / Log.
 */
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { Tabs } from "@/components/Tabs";
import { useState } from "react";
import { ExecConsole } from "./ExecConsole";
import { FileBrowser } from "./FileBrowser";
import { LogsPanel } from "./LogsPanel";
import { PolicyPanel } from "./PolicyPanel";
import { SyncPanel } from "./SyncPanel";
import type { ProviderCapabilities, SandboxDetail as Detail, SessionRow } from "./types";
import { limitsLabel, remainLabel, timeLabel } from "./util";

type Notify = (message: string, kind?: "ok" | "err" | "warn") => void;

type TabKey = "exec" | "policy" | "sync" | "files" | "logs";

interface SandboxDetailProps {
  sandboxId: string | null;
  detail: Detail | null;
  loading: boolean;
  /** Phiên đang trỏ tới sandbox này (mọi trạng thái live) — null khi mồ côi. */
  session: SessionRow | null;
  capabilities: ProviderCapabilities;
  onExecBusyChange: (busy: boolean) => void;
  onChanged: () => void;
  notify: Notify;
}

function providerTone(state: string | null | undefined): "green" | "yellow" | "red" {
  if (state === "running") return "green";
  if (state === "paused") return "yellow";
  return "red";
}

export function SandboxDetail({
  sandboxId,
  detail,
  loading,
  session,
  capabilities,
  onExecBusyChange,
  onChanged,
  notify,
}: SandboxDetailProps) {
  const [tab, setTab] = useState<TabKey>("exec");

  if (!sandboxId) {
    return (
      <Card title="Chi tiết sandbox">
        <EmptyState title="Chọn một phiên có sandbox để xem" />
      </Card>
    );
  }

  const info = detail?.info;
  const metrics = detail?.metrics;
  const runningSession = session !== null && session.state === "RUNNING" ? session : null;

  // Tab phù hợp theo khả năng: sandbox mồ côi (không phiên) → ẩn exec/policy/sync.
  const tabItems: ReadonlyArray<{ key: TabKey; label: string }> = [
    ...(session ? [{ key: "exec" as TabKey, label: "Chạy lệnh" }] : []),
    ...(session ? [{ key: "policy" as TabKey, label: "Kiểm tra lệnh" }] : []),
    ...(session ? [{ key: "sync" as TabKey, label: "Đồng bộ" }] : []),
    { key: "files", label: "File /workspace" },
    { key: "logs", label: "Log" },
  ];
  const activeTab = tabItems.some((item) => item.key === tab) ? tab : "files";

  return (
    <Card title="Chi tiết sandbox" actions={<span className="sbx-meta sbx-mono">{sandboxId}</span>}>
      {loading && !detail ? (
        <Spinner label="Đang tải thông tin container…" />
      ) : detail === null || info === undefined ? (
        <EmptyState title="Không tải được chi tiết sandbox" />
      ) : (
        <>
          {info.error ? (
            <div className="sbx-meta" style={{ color: "var(--color-danger)", marginBottom: 8 }}>
              {info.error.message ?? "Provider báo lỗi khi mô tả sandbox."}
            </div>
          ) : null}

          <dl className="sbx-kv">
            <dt>Trạng thái</dt>
            <dd>
              <Badge tone={providerTone(info.state)}>{info.state ?? "?"}</Badge>
            </dd>
            <dt>Phiên</dt>
            <dd className="sbx-mono">{info.session_id ?? "—"}</dd>
            <dt>Image</dt>
            <dd className="sbx-mono">{info.image ?? "—"}</dd>
            <dt>Tạo lúc</dt>
            <dd>{timeLabel(info.created_at)}</dd>
            <dt>Hết hạn</dt>
            <dd>
              {info.expires_at ? `${timeLabel(info.expires_at)} (${remainLabel(info.expires_at)})` : "không hết hạn"}
            </dd>
            <dt>Cổng trình thực thi</dt>
            <dd className="sbx-mono">{info.dial_target ?? "—"}</dd>
            <dt>Volume /workspace</dt>
            <dd className="sbx-mono">{info.volume ?? "—"}</dd>
            <dt>Giới hạn</dt>
            <dd>{limitsLabel(info.cpu, info.memory_mb)}</dd>
            <dt>Mạng</dt>
            <dd>{info.network ?? "—"}</dd>
            {info.oom_killed ? (
              <>
                <dt>OOM</dt>
                <dd>
                  <Badge tone="red">bị kill vì hết RAM</Badge>
                </dd>
              </>
            ) : null}
          </dl>

          {/* Số liệu thật từ Docker stats (nếu provider hỗ trợ) */}
          {metrics?.available ? (
            <div className="sbx-meta" style={{ marginTop: 10 }}>
              <div>
                CPU {metrics.cpu_percent ?? 0}% · RAM {metrics.memory_bytes ?? 0} /{" "}
                {metrics.memory_limit_bytes ?? 0} bytes
                {metrics.pids != null ? ` · ${metrics.pids} tiến trình` : ""}
              </div>
              <div className="sbx-meter">
                <div
                  style={{
                    width: `${
                      metrics.memory_limit_bytes
                        ? Math.min(100, ((metrics.memory_bytes ?? 0) / metrics.memory_limit_bytes) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          ) : metrics?.reason ? (
            <div className="sbx-meta" style={{ marginTop: 10 }}>
              Số liệu: {metrics.reason}
            </div>
          ) : null}

          <div style={{ marginTop: 14 }}>
            <Tabs items={tabItems} active={activeTab} onChange={setTab} />
            <div style={{ paddingTop: 12 }}>
              {activeTab === "exec" ? (
                <ExecConsole
                  sessionId={runningSession?.session_id ?? null}
                  running={runningSession !== null}
                  onBusyChange={onExecBusyChange}
                  notify={notify}
                />
              ) : null}
              {activeTab === "policy" ? <PolicyPanel notify={notify} /> : null}
              {activeTab === "sync" ? (
                <SyncPanel session={runningSession} onChanged={onChanged} notify={notify} />
              ) : null}
              {activeTab === "files" ? (
                <FileBrowser sandboxId={sandboxId} listing={detail.workspace} notify={notify} />
              ) : null}
              {activeTab === "logs" ? (
                <LogsPanel
                  sandboxId={sandboxId}
                  supported={capabilities.diagnostics !== false}
                  notify={notify}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
