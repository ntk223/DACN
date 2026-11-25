/**
 * SandboxDetail.tsx — thông tin container CHỈ ĐỌC của sandbox đang chọn
 * (trang Quản lý): image, phiên, volume, giới hạn tài nguyên, CPU/RAM meter.
 * Các tab thao tác đã chuyển sang trang SandboxOpsPage.
 */
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { formatBytes } from "@/lib/format";
import type { ReactNode } from "react";
import type { SandboxDetail as Detail } from "./types";
import { limitsLabel, remainLabel, timeLabel } from "./util";

interface SandboxDetailProps {
  sandboxId: string | null;
  detail: Detail | null;
  loading: boolean;
}

function providerTone(state: string | null | undefined): "green" | "yellow" | "red" {
  if (state === "running") return "green";
  if (state === "paused") return "yellow";
  return "red";
}

/** Một mục key/value trong dl — bọc trong div để xếp 2 cột đều nhau. */
function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sbx-kv-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SandboxDetail({ sandboxId, detail, loading }: SandboxDetailProps) {
  if (!sandboxId) {
    return (
      <Card title="Thông tin container">
        <EmptyState title="Chọn một phiên có sandbox để xem" />
      </Card>
    );
  }

  const info = detail?.info;
  const metrics = detail?.metrics;

  // % RAM dùng được tính trực tiếp; CPU percent so với 1 core = 100%.
  const ramPercent =
    metrics?.memory_limit_bytes
      ? Math.min(100, ((metrics.memory_bytes ?? 0) / metrics.memory_limit_bytes) * 100)
      : 0;
  const cpuPercent = Math.min(100, metrics?.cpu_percent ?? 0);

  return (
    <Card
      // Tiêu đề = sandbox_id mono lớn — định danh chính của sandbox.
      title={<span className="sbx-title-mono">{sandboxId}</span>}
      actions={<span className="sbx-meta">Thông tin container — chỉ đọc</span>}
    >
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
            <Kv label="Trạng thái">
              <Badge tone={providerTone(info.state)}>{info.state ?? "?"}</Badge>
            </Kv>
            <Kv label="Phiên">
              <span className="sbx-mono">{info.session_id ?? "—"}</span>
            </Kv>
            <Kv label="Image">
              <span className="sbx-mono">{info.image ?? "—"}</span>
            </Kv>
            <Kv label="Tạo lúc">{timeLabel(info.created_at)}</Kv>
            <Kv label="Hết hạn">
              {info.expires_at ? `${timeLabel(info.expires_at)} (${remainLabel(info.expires_at)})` : "không hết hạn"}
            </Kv>
            <Kv label="Cổng trình thực thi">
              <span className="sbx-mono">{info.dial_target ?? "—"}</span>
            </Kv>
            <Kv label="Volume /workspace">
              <span className="sbx-mono">{info.volume ?? "—"}</span>
            </Kv>
            <Kv label="Giới hạn">{limitsLabel(info.cpu, info.memory_mb)}</Kv>
            <Kv label="Mạng">
              <span className="sbx-mono">{info.network ?? "—"}</span>
            </Kv>
            {info.oom_killed ? (
              <Kv label="OOM">
                <Badge tone="red">bị kill vì hết RAM</Badge>
              </Kv>
            ) : null}
          </dl>

          {/* Số liệu thật từ Docker stats (nếu provider hỗ trợ) */}
          {metrics?.available ? (
            <div className="sbx-metrics">
              <div className="sbx-metric">
                <span>
                  CPU <b>{metrics.cpu_percent ?? 0}%</b>
                </span>
                <div className="sbx-meter">
                  <div style={{ width: `${cpuPercent}%` }} />
                </div>
              </div>
              <div className="sbx-metric">
                <span>
                  RAM <b>{formatBytes(metrics.memory_bytes ?? 0)}</b> / {formatBytes(metrics.memory_limit_bytes ?? 0)}
                </span>
                <div className="sbx-meter">
                  <div style={{ width: `${ramPercent}%` }} />
                </div>
              </div>
              {metrics.pids != null ? <span>{metrics.pids} tiến trình</span> : null}
            </div>
          ) : metrics?.reason ? (
            <div className="sbx-meta" style={{ marginTop: 10 }}>
              Số liệu: {metrics.reason}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
