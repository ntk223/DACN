/**
 * SandboxData.tsx — trạng thái dữ liệu dùng chung cho 2 trang Sandbox
 * (Thao tác / Quản lý): hook tải overview + chi tiết container với
 * auto-refresh 5 giây, và 2 khung hiển thị lỗi khi tải.
 */
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { sandboxApi } from "./sandboxApi";
import type { Overview, SandboxDetail as Detail } from "./types";

const REFRESH_MS = 5000;

export interface LoadError {
  message: string;
  /** provider_unavailable / không kết nối được → hướng dẫn make image && make run-docker. */
  providerUnavailable: boolean;
}

/** Props bắt focus/blur để tạm dừng auto-refresh khi người dùng đang gõ. */
export interface TypingProps {
  onFocusCapture: (event: FocusEvent<HTMLDivElement>) => void;
  onBlurCapture: (event: FocusEvent<HTMLDivElement>) => void;
}

export interface SandboxData {
  overview: Overview | null;
  error: LoadError | null;
  /** true trong lúc request làm mới đang chạy → chỉ báo "đang cập nhật…". */
  refreshing: boolean;
  /** Sandbox đang chọn (mỗi trang tự quản ý nghĩa chọn của mình). */
  selectedId: string | null;
  setSelectedId: (sandboxId: string | null) => void;
  /** Chi tiết container của sandbox đang chọn — im lặng khi refresh nền. */
  detail: Detail | null;
  detailLoading: boolean;
  /** Tải lại overview + chi tiết ngay (nút "Tải lại" / sau thao tác). */
  reloadAll: () => void;
  /** Spread lên div gốc của trang để phát hiện đang gõ. */
  typingProps: TypingProps;
}

/**
 * Tải overview (phiên + mồ côi + provider) và chi tiết sandbox đang chọn.
 * `paused` = true khi trang muốn dừng auto-refresh (modal mở, lệnh đang chạy,
 * người dùng tắt checkbox) — ngoài ra vẫn dừng khi đang gõ hoặc tab ẩn.
 */
export function useSandboxData(paused: boolean): SandboxData {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const pausedRef = useRef(false);
  pausedRef.current = paused;
  // Ref cho điều kiện tạm dừng auto-refresh: đang gõ vào input nào đó trong trang.
  const typingRef = useRef(false);

  const loadOverview = useCallback(async () => {
    setRefreshing(true);
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
    } finally {
      setRefreshing(false);
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

  const reloadAll = useCallback(() => {
    void loadOverview();
    void loadDetail(selectedId);
  }, [loadOverview, loadDetail, selectedId]);

  // Lần đầu mount: tải overview (chi tiết do effect theo selectedId bên dưới lo).
  useEffect(() => {
    void loadOverview();
    // Chỉ chạy một lần khi mount — selectedId cập nhật qua effect định kỳ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đổi sandbox đang chọn → tải chi tiết ngay, không chờ nhịp auto-refresh 5s.
  useEffect(() => {
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  // Auto-refresh 5 giây: dừng khi paused, đang gõ, tab ẩn.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current || typingRef.current || document.hidden) return;
      void loadOverview();
      void loadDetail(selectedId);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadOverview, loadDetail, selectedId]);

  const typingProps: TypingProps = {
    // Đang gõ (focus vào input/textarea/select) → tạm dừng auto-refresh để không nhấp nháy mất state.
    onFocusCapture: (event) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) typingRef.current = true;
    },
    onBlurCapture: (event) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) typingRef.current = false;
    },
  };

  return {
    overview,
    error,
    refreshing,
    selectedId,
    setSelectedId,
    detail,
    detailLoading,
    reloadAll,
    typingProps,
  };
}

/** Toàn màn khi chưa tải được dữ liệu lần nào — kèm hướng dẫn khi thiếu Docker. */
export function LoadErrorCard({ error, onRetry }: { error: LoadError; onRetry: () => void }) {
  return (
    <Card>
      {error.providerUnavailable ? (
        <EmptyState
          icon="📦"
          title="Provider sandbox chưa sẵn sàng"
          description="Không kết nối được Docker — cần build image và khởi động provider trước."
        >
          <ol className="sbx-steps">
            <li>
              Build image sandbox: <code>make image</code>
            </li>
            <li>
              Khởi động provider: <code>make run-docker</code>
            </li>
            <li>
              Bấm “Thử lại” bên dưới để tải lại danh sách phiên.
            </li>
          </ol>
          <Button variant="primary" style={{ marginTop: 16 }} onClick={onRetry}>
            Thử lại
          </Button>
        </EmptyState>
      ) : (
        <EmptyState title="Không tải được danh sách sandbox">{error.message}</EmptyState>
      )}
      {!error.providerUnavailable ? (
        <Button style={{ marginTop: 12 }} onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
    </Card>
  );
}

/** Banner nhỏ khi refresh nền lỗi — vẫn hiển thị dữ liệu cũ. */
export function LoadErrorBanner({ message }: { message: string }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <span className="sbx-meta" style={{ color: "var(--color-warning)" }}>
        Làm mới lỗi: {message} — đang hiển thị dữ liệu cũ.
      </span>
    </Card>
  );
}
