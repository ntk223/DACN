/**
 * SandboxDetail.tsx — thông tin container CHỈ ĐỌC của sandbox đang chọn
 * (trang Quản lý): image, phiên, volume, giới hạn tài nguyên, CPU/RAM meter.
 * Các tab thao tác đã chuyển sang trang SandboxOpsPage.
 */
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { formatBytes, providerTone } from "@/lib/format";
import type { SandboxDetail as Detail } from "./types";
import { limitsLabel, remainLabel, timeLabel } from "./util";

interface SandboxDetailProps {
  sandboxId: string | null;
  detail: Detail | null;
  loading: boolean;
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

          <dl className="kv kv--cols">
            <div>
              <dt>Trạng thái</dt>
              <dd>
                <Badge tone={providerTone(info.state)}>{info.state ?? "?"}</Badge>
              </dd>
            </div>
            <div>
              <dt>Phiên</dt>
              <dd><span className="sbx-mono">{info.session_id ?? "—"}</span></dd>
            </div>
            <div>
              <dt>Image</dt>
              <dd><span className="sbx-mono">{info.image ?? "—"}</span></dd>
            </div>
            <div>
              <dt>Tạo lúc</dt>
              <dd>{timeLabel(info.created_at)}</dd>
            </div>
            <div>
              <dt>Hết hạn</dt>
              <dd>
                {info.expires_at
                  ? `${timeLabel(info.expires_at)} (${remainLabel(info.expires_at)})`
                  : "không hết hạn"}
              </dd>
            </div>
            <div>
              <dt>Cổng trình thực thi</dt>
              <dd><span className="sbx-mono">{info.dial_target ?? "—"}</span></dd>
            </div>
            <div>
              <dt>Volume /workspace</dt>
              <dd><span className="sbx-mono">{info.volume ?? "—"}</span></dd>
            </div>
            <div>
              <dt>Giới hạn</dt>
              <dd>{limitsLabel(info.cpu, info.memory_mb)}</dd>
            </div>
            <div>
              <dt>Mạng</dt>
              <dd><span className="sbx-mono">{info.network ?? "—"}</span></dd>
            </div>
            {info.oom_killed ? (
              <div>
                <dt>OOM</dt>
                <dd>
                  <Badge tone="red">bị kill vì hết RAM</Badge>
                </dd>
              </div>
            ) : null}
          </dl>

          {/* Số liệu thật từ Docker stats (nếu provider hỗ trợ) */}
          {metrics?.available ? (
            <div className="sbx-metrics">
              <div className="sbx-metric">
                <span>
                  CPU <b>{metrics.cpu_percent ?? 0}%</b>
                </span>
                <div className="meter">
                  <div style={{ width: `${cpuPercent}%` }} />
                </div>
              </div>
              <div className="sbx-metric">
                <span>
                  RAM <b>{formatBytes(metrics.memory_bytes ?? 0)}</b> / {formatBytes(metrics.memory_limit_bytes ?? 0)}
                </span>
                <div className="meter">
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
