/**
 * SandboxPage.tsx — trang quản lý Sandbox: bảng phiên + mồ côi (trái),
 * chi tiết container + các tab thao tác (phải). Tự làm mới mỗi 5 giây,
 * tạm dừng khi có modal mở / lệnh đang chạy / người dùng đang gõ.
 */
import { ApiError } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { sandboxApi } from "./sandboxApi";
import { SandboxDetail } from "./SandboxDetail";
import { SandboxTable } from "./SandboxTable";
import { ToastStack, useToasts } from "./Toast";
import "./sandbox.css";
import type { Overview, SandboxDetail as Detail, SessionRow } from "./types";

const REFRESH_MS = 5000;

interface LoadError {
  message: string;
  /** provider_unavailable / không kết nối được → hướng dẫn make image && make run-docker. */
  providerUnavailable: boolean;
}

export function SandboxPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [execBusy, setExecBusy] = useState(false);
  const { toasts, push } = useToasts();

  // Ref cho điều kiện tạm dừng auto-refresh: đang gõ vào input nào đó trong trang.
  const typingRef = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = !autoRefresh || modalOpen || execBusy;

  /** Tải overview (danh sách phiên + mồ côi + provider). */
  const loadOverview = useCallback(async () => {
    try {
      const data = await sandboxApi.overview();
      setOverview(data);
      setError(null);
    } catch (err) {
      // Lỗi mạng (fetch throw TypeError) hoặc provider_unavailable → Docker chưa chạy.
      const isApi = err instanceof ApiError;
      setError({
        message: err instanceof Error ? err.message : "Không tải được dữ liệu",
        providerUnavailable: !isApi || err.code === "provider_unavailable",
      });
    }
  }, []);

  /** Tải chi tiết container cho sandbox đang chọn (im lặng khi refresh nền). */
  const loadDetail = useCallback(async (sandboxId: string | null) => {
    if (!sandboxId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const data = await sandboxApi.detail(sandboxId);
      setDetail(data);
    } catch {
      // Sandbox vừa bị xóa / mất → bỏ chọn.
      setDetail(null);
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Lần đầu + nút "Tải lại": overview + detail.
  const reloadAll = useCallback(() => {
    void loadOverview();
    void loadDetail(selectedId);
  }, [loadOverview, loadDetail, selectedId]);

  useEffect(() => {
    reloadAll();
    // Chỉ chạy một lần khi mount — selectedId cập nhật qua các effect khác.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh 5 giây: dừng khi modal mở, exec đang chạy, đang gõ, tab ẩn.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current || typingRef.current || document.hidden) return;
      void loadOverview();
      void loadDetail(selectedId);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadOverview, loadDetail, selectedId]);

  /** Phiên khớp sandbox đang chọn (trạng thái nào cũng được, cần cho tab Đồng bộ). */
  const sessionForRow: SessionRow | null =
    overview && selectedId
      ? (overview.sessions.find((s) => s.sandbox_id === selectedId) ?? null)
      : null;

  if (error !== null && overview === null) {
    // Chưa có dữ liệu lần nào — hiển thị toàn màn (kèm hướng dẫn khi thiếu Docker).
    return (
      <>
        <Card>
          {error.providerUnavailable ? (
            <EmptyState
              icon="📦"
              title="Provider sandbox chưa sẵn sàng"
              description="Không kết nối được Docker — cần build image và khởi động provider trước."
            >
              <div className="sbx-mono" style={{ marginTop: 8 }}>
                make image && make run-docker
              </div>
            </EmptyState>
          ) : (
            <EmptyState title="Không tải được danh sách sandbox">
              {error.message}
            </EmptyState>
          )}
          <Button style={{ marginTop: 12 }} onClick={reloadAll}>
            Thử lại
          </Button>
        </Card>
        <ToastStack toasts={toasts} />
      </>
    );
  }

  return (
    <div
      // Đang gõ (focus vào input/textarea/select) → tạm dừng auto-refresh để không nhấp nháy mất state.
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) typingRef.current = true;
      }}
      onBlurCapture={(event) => {
        const target = event.target as HTMLElement;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) typingRef.current = false;
      }}
    >
      {error !== null ? (
        <Card style={{ marginBottom: 12 }}>
          <span className="sbx-meta" style={{ color: "var(--color-warning)" }}>
            Làm mới lỗi: {error.message} — đang hiển thị dữ liệu cũ.
          </span>
        </Card>
      ) : null}

      <div className="sbx-layout">
        <SandboxTable
          sessions={overview?.sessions ?? []}
          orphans={overview?.orphans ?? []}
          capabilities={overview?.capabilities ?? {}}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onModalOpenChange={setModalOpen}
          onChanged={reloadAll}
          notify={push}
        />

        <div className="sbx-col">
          <div className="sbx-toolbar">
            <span className="sbx-meta">
              provider: {overview?.provider ?? "…"} · image {overview?.image ?? "…"}
            </span>
            <span className="spacer" />
            <label className="sbx-meta" style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
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

          <SandboxDetail
            sandboxId={selectedId}
            detail={detail}
            loading={detailLoading}
            session={sessionForRow}
            capabilities={overview?.capabilities ?? {}}
            onExecBusyChange={setExecBusy}
            onChanged={reloadAll}
            notify={push}
          />
        </div>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
