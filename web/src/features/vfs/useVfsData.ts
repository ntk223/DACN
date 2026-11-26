/**
 * useVfsData.ts — các effect tải dữ liệu của trang VFS · Thao tác tách thành hook:
 * overview (danh sách workspace + ngưỡng cấu hình), chi tiết workspace, chi tiết file.
 * Hành vi giữ nguyên như bản cũ: hủy kết quả khi deps đổi, loading/error/version bump.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { errorMessage, vfsApi } from "./vfsApi";
import type { FileDetail, Overview, WorkspaceDetail } from "./types";

/**
 * Danh sách workspace + ngưỡng cấu hình: tải lần đầu và refresh khi cần.
 * - navAppliedRef: đã có yêu cầu điều hướng áp dụng → KHÔNG tự chọn workspace cuối.
 * - autoSelect: callback chọn workspace cuối khi vào trang trực tiếp (setWsId).
 */
export function useVfsOverview(
  navAppliedRef: RefObject<boolean>,
  autoSelect: (workspaceId: string) => void,
): {
  overview: Overview | null;
  overviewError: string | null;
  /** Tải lại danh sách; trả dữ liệu mới (hoặc null nếu lỗi) cho caller dùng tiếp. */
  refresh: () => Promise<Overview | null>;
} {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // ---- Lần đầu: tải overview và tự chọn workspace cuối (như trang cũ) ----
  useEffect(() => {
    let cancelled = false;
    vfsApi
      .overview()
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        // Có yêu cầu điều hướng từ trang Quản lý → useNavEffect đã chọn
        // workspace theo yêu cầu, không tự chọn workspace cuối nữa.
        if (navAppliedRef.current) return;
        if (data.workspaces.length > 0) {
          const last = data.workspaces[data.workspaces.length - 1];
          if (last !== undefined) autoSelect(last.id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setOverviewError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [navAppliedRef, autoSelect]);

  const refresh = useCallback(async (): Promise<Overview | null> => {
    try {
      const data = await vfsApi.overview();
      setOverview(data);
      setOverviewError(null);
      return data;
    } catch (error) {
      setOverviewError(errorMessage(error));
      return null;
    }
  }, []);

  return { overview, overviewError, refresh };
}

/** Chi tiết workspace theo workspace đang chọn / khi cần refresh (bump version). */
export function useWorkspaceDetail(
  wsId: string | null,
  version: number,
): {
  detail: WorkspaceDetail | null;
  loading: boolean;
  error: string | null;
} {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wsId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    vfsApi
      .workspace(wsId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wsId, version]);

  return { detail, loading, error };
}

/**
 * Chi tiết file đang mở: tải khi chọn path / refresh (bump version).
 * onLoaded: nhận nội dung file sau khi tải (set content + markDirty(false)).
 * Trả cả setter gốc để caller giữ nguyên các thao tác reset như bản cũ.
 */
export function useFileDetail(
  wsId: string | null,
  activePath: string | null,
  isNew: boolean,
  version: number,
  onLoaded: (data: FileDetail) => void,
): {
  file: FileDetail | null;
  setFile: (file: FileDetail | null) => void;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
} {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Giữ callback mới nhất trong ref — effect không phụ thuộc closure cũ.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    if (wsId === null || activePath === null || isNew) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    vfsApi
      .file(wsId, activePath)
      .then((data) => {
        if (cancelled) return;
        setFile(data);
        onLoadedRef.current(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFile(null);
          setError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wsId, activePath, version, isNew]);

  return { file, setFile, loading, error, setError };
}
