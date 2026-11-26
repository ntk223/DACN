/**
 * SandboxManagePage.tsx — trang QUẢN LÝ sandbox: chỉ HIỂN THỊ thông tin.
 * Bảng tất cả phiên (thông tin thuần) + sandbox mồ côi (dọn là việc quản trị
 * hệ thống — nút "Dọn" là ngoại lệ duy nhất còn nút hành động). Bấm vào hàng
 * phiên nào cũng jump sang trang Thao tác của phiên đó (onOpenOps) — kể cả
 * phiên STANDBY (sang Thao tác để bật). Mọi thao tác vòng đời nằm ở trang
 * Thao tác. Tự làm mới 5 giây với chỉ báo "đang cập nhật…".
 */
import { Button } from "@/components/Button";
import { ToastStack, useToasts } from "@/components/Toast";
import type { OpenSandboxOps } from "@/lib/nav";
import { useState } from "react";
import { LoadErrorBanner, LoadErrorCard, useSandboxData } from "./SandboxData";
import { SandboxTable } from "./SandboxTable";
import "./sandbox.css";

export function SandboxManagePage({ onOpenOps }: { onOpenOps?: OpenSandboxOps }) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { toasts, push } = useToasts();

  const { overview, error, refreshing, reloadAll, typingProps } = useSandboxData(!autoRefresh);

  if (error !== null && overview === null) {
    // Chưa có dữ liệu lần nào — hiển thị toàn màn (kèm hướng dẫn khi thiếu Docker).
    return (
      <>
        <LoadErrorCard error={error} onRetry={reloadAll} />
        <ToastStack toasts={toasts} />
      </>
    );
  }

  return (
    <div {...typingProps}>
      {error !== null ? <LoadErrorBanner message={error.message} /> : null}

      <div className="sbx-col">
        {/* Toolbar: provider/image + chỉ báo đang cập nhật + điều khiển auto-refresh */}
        <div className="sbx-toolbar">
          <span className="sbx-meta">
            provider: {overview?.provider ?? "…"} · image {overview?.image ?? "…"}
          </span>
          <span className="spacer" />
          {refreshing ? (
            <span className="sbx-meta sbx-refreshing" role="status" aria-live="polite">
              đang cập nhật…
            </span>
          ) : null}
          <label className="sbx-meta sbx-check">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            tự làm mới 5s
          </label>
          <Button size="sm" onClick={reloadAll}>
            Tải lại
          </Button>
        </div>

        <SandboxTable
          sessions={overview?.sessions ?? []}
          orphans={overview?.orphans ?? []}
          onOpenOps={onOpenOps}
          onChanged={reloadAll}
          notify={push}
        />
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
