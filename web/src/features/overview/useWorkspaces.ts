/**
 * useWorkspaces.ts — hook tải danh sách workspace (GET /admin/api/overview)
 * dùng chung cho các tab Console / Tải lên. Có AbortSignal khi unmount.
 */

import { useCallback, useEffect, useState } from "react";

import { get } from "@/lib/api";

import type { WorkspaceRow } from "./types";

export interface WorkspacesState {
  workspaces: WorkspaceRow[];
  loading: boolean;
  error: string | null;
  /** Gọi lại thủ công (sau khi tạo workspace mới…). */
  reload: () => void;
}

export function useWorkspaces(): WorkspacesState {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    get<{ settings: unknown; workspaces: WorkspaceRow[] }>("/admin/api/overview", {
      signal: controller.signal,
    })
      .then((data) => {
        setWorkspaces(data.workspaces ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // unmount — bỏ qua
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [tick]);

  return { workspaces, loading, error, reload };
}
