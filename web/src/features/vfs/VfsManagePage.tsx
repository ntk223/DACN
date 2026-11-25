import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { Tabs } from "@/components/Tabs";
import { AlgoLab } from "./AlgoLab";
import { HistoryPanel } from "./HistoryPanel";
import { OpsPanel } from "./OpsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ToastStack, useToasts } from "./Toast";
import { TombsPanel } from "./TombsPanel";
import { PencilIcon, WorkspaceList } from "./WorkspaceList";
import { WorkspaceMeta } from "./WorkspaceMeta";
import { errorMessage, vfsApi } from "./vfsApi";
import type { OpenVfsOps, VfsManageRequest } from "@/lib/nav";
import type { FileDetail, Overview, WorkspaceDetail } from "./types";
import "./vfs.css";

type VfsManageTab = "history" | "tombs" | "ops" | "algo";

/**
 * Trang VFS · Quản lý — trang THÔNG TIN thuần, một cột full-width:
 * trên cùng là danh sách workspace (chỉ hiển thị: tên, hạn mức, policy,
 * số file, phiên đang chạy — bấm cả hàng → nhảy trang Thao tác), dưới là
 * tabs Lịch sử / Dấu xóa / Sổ thao tác / Thuật toán với dropdown chọn
 * workspace, cuối là ngưỡng cấu hình (đọc).
 * Không có form tạo workspace và không sửa file tại đây: tạo workspace
 * nằm ở trang Thao tác (+ Workspace); Lịch sử chọn file qua ô chọn đường
 * dẫn, nút "Sửa file này" → nhảy Thao tác đúng file.
 * Nhận `navRequest` từ trang Thao tác ("Xem tất cả" / "Lịch sử" file): chọn
 * workspace trong dropdown + nếu có file thì bật tab Lịch sử với đúng path.
 */
interface VfsManagePageProps {
  onOpenOps?: OpenVfsOps;
  /** Yêu cầu điều hướng từ trang Thao tác — phản ứng theo nonce. */
  navRequest?: VfsManageRequest;
}

export function VfsManagePage({ onOpenOps, navRequest }: VfsManagePageProps) {
  const { toasts, push } = useToasts();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [wsId, setWsId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);

  const [tab, setTab] = useState<VfsManageTab>("history");
  const [histPath, setHistPath] = useState("");
  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  /** Nonce của navRequest đã áp dụng — null nghĩa là chưa có yêu cầu điều hướng nào. */
  const lastNavNonceRef = useRef<number | null>(null);

  // ---- Lần đầu: tải overview, mặc định chọn workspace đầu tiên ----
  useEffect(() => {
    let cancelled = false;
    vfsApi
      .overview()
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        // Có yêu cầu điều hướng từ trang Thao tác → effect bên dưới đã chọn
        // workspace theo yêu cầu, không tự chọn workspace đầu tiên nữa.
        if (lastNavNonceRef.current !== null) return;
        const first = data.workspaces[0];
        if (first !== undefined) setWsId(first.id);
      })
      .catch((error: unknown) => {
        if (!cancelled) setOverviewError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Yêu cầu "Thao tác → Quản lý": chọn workspace + tab Lịch sử theo navRequest ----
  // Chỉ phản ứng khi nonce mới xuất hiện; vào trang qua sidebar thì giữ nguyên lựa chọn.
  useEffect(() => {
    if (navRequest === undefined) return;
    const { nonce, workspaceId, file } = navRequest;
    if (workspaceId === undefined && file === undefined) return;
    if (nonce === lastNavNonceRef.current) return;
    lastNavNonceRef.current = nonce;
    if (workspaceId !== undefined) {
      setWsId(workspaceId);
      setFileDetail(null);
      setFileError(null);
      // Đổi workspace mà không kèm file → không giữ path cũ của workspace khác.
      if (file === undefined) setHistPath("");
    }
    if (file !== undefined) {
      setTab("history");
      setHistPath(file);
      setFileDetail(null);
      setFileError(null);
    }
  }, [navRequest]);

  // ---- Chi tiết workspace theo dropdown / khi cần refresh ----
  useEffect(() => {
    if (wsId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    vfsApi
      .workspace(wsId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wsId, detailVersion]);

  // ---- Chi tiết file cho tab Lịch sử khi chọn đường dẫn / refresh ----
  useEffect(() => {
    if (wsId === null || histPath.trim().length === 0) {
      setFileDetail(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    vfsApi
      .file(wsId, histPath.trim())
      .then((data) => {
        if (!cancelled) setFileDetail(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFileDetail(null);
          setFileError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wsId, histPath, fileVersion]);

  const refreshOverview = useCallback(async () => {
    try {
      const data = await vfsApi.overview();
      setOverview(data);
      setOverviewError(null);
    } catch (error) {
      setOverviewError(errorMessage(error));
    }
  }, []);

  const selectWorkspace = useCallback((id: string) => {
    setWsId(id);
    setHistPath("");
    setFileDetail(null);
    setFileError(null);
  }, []);

  /** Khôi phục bản lịch sử xong → làm mới workspace + file đang xem. */
  const refreshAfterRestore = useCallback(() => {
    setDetailVersion((v) => v + 1);
    setFileVersion((v) => v + 1);
  }, []);

  /** Danh sách đường dẫn cho ô chọn file (sắp xếp như cây). */
  const filePaths = useMemo(
    () => (detail?.files ?? []).map((f) => f.path).sort((a, b) => a.localeCompare(b)),
    [detail],
  );

  const wsTitle = detail !== null ? (detail.name ?? detail.workspace.id) : null;

  const tabItems = useMemo(
    () => [
      { key: "history" as const, label: "Lịch sử" },
      {
        key: "tombs" as const,
        label: (
          <>
            Dấu xóa{detail !== null ? <span className="vfs-dim"> {detail.tombstones.length}</span> : null}
          </>
        ),
      },
      {
        key: "ops" as const,
        label: (
          <>
            Sổ thao tác{detail !== null ? <span className="vfs-dim"> {detail.operations.length}</span> : null}
          </>
        ),
      },
      { key: "algo" as const, label: "Thuật toán" },
    ],
    [detail],
  );

  return (
    <div className="vfs-layout vfs-layout--manage">
      <ToastStack toasts={toasts} />

      {/* ================= Danh sách workspace — thông tin, bấm cả hàng → Thao tác ================= */}
      <Card title="Workspaces">
        {overviewError !== null ? (
          <EmptyState title="Không tải được danh sách" description={overviewError}>
            <Button size="sm" onClick={() => void refreshOverview()}>
              Thử lại
            </Button>
          </EmptyState>
        ) : overview === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
            <Spinner label="Đang tải workspace…" />
          </div>
        ) : (
          <WorkspaceList overview={overview} activeId={wsId} onOpenOps={onOpenOps} />
        )}
      </Card>

      {/* ================= Tabs dữ liệu theo dropdown workspace ================= */}
      <Card title={wsTitle ?? "Dữ liệu workspace"}>
        {overview !== null && overview.workspaces.length > 0 ? (
          <div className="vfs-row" style={{ marginBottom: 12 }}>
            <label className="vfs-small vfs-dim" htmlFor="vfs-manage-ws">
              Workspace
            </label>
            <select
              id="vfs-manage-ws"
              className="select vfs-grow"
              value={wsId ?? ""}
              onChange={(e) => selectWorkspace(e.target.value)}
            >
              {overview.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name ?? w.id}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {wsId === null ? (
          <EmptyState
            title="Chưa chọn workspace"
            description="Danh sách workspace hiển thị ở trên — bấm một workspace để xem chi tiết & thao tác."
          >
            <ul className="vfs-hints">
              <li>Chưa có dữ liệu? Chạy <span className="kbd">make seed</span> để tạo dữ liệu mẫu.</li>
              <li>Cần tạo workspace mới? Dùng nút <b>+ Workspace</b> ở trang VFS · Thao tác.</li>
            </ul>
          </EmptyState>
        ) : detailError !== null ? (
          <EmptyState title="Không tải được workspace" description={detailError}>
            <Button
              size="sm"
              onClick={() => {
                setDetailVersion((v) => v + 1);
              }}
            >
              Tải lại
            </Button>
          </EmptyState>
        ) : detail === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
            <Spinner label="Đang tải chi tiết…" />
          </div>
        ) : (
          <>
            <WorkspaceMeta detail={detail} />

            {detailLoading ? (
              <div style={{ marginTop: 8 }}>
                <Spinner label="Đang làm mới…" />
              </div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              <Tabs items={tabItems} active={tab} onChange={setTab} />

              <div style={{ marginTop: 12 }}>
                {tab === "history" ? (
                  <>
                    <div className="vfs-row" style={{ marginBottom: 10 }}>
                      <label className="vfs-small vfs-dim" htmlFor="vfs-hist-path">
                        Đường dẫn file
                      </label>
                      <select
                        id="vfs-hist-path"
                        className="select vfs-grow"
                        value={histPath}
                        onChange={(e) => setHistPath(e.target.value)}
                      >
                        <option value="">— chọn file để xem lịch sử —</option>
                        {filePaths.map((path) => (
                          <option key={path} value={path}>
                            {path}
                          </option>
                        ))}
                      </select>
                      {onOpenOps !== undefined ? (
                        <Button
                          size="sm"
                          title="Sửa file này trong trang Thao tác"
                          disabled={histPath.trim().length === 0}
                          onClick={() => onOpenOps(wsId, histPath.trim())}
                        >
                          <PencilIcon />
                          Sửa file này
                        </Button>
                      ) : null}
                    </div>
                    {fileLoading ? (
                      <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                        <Spinner label="Đang tải file…" />
                      </div>
                    ) : fileError !== null ? (
                      <EmptyState title="Không tải được file" description={fileError} />
                    ) : (
                      <HistoryPanel
                        key={`${histPath}:${fileVersion}`}
                        wsId={wsId}
                        file={fileDetail}
                        isNew={false}
                        onToast={push}
                        onRefresh={refreshAfterRestore}
                      />
                    )}
                  </>
                ) : null}

                {tab === "tombs" ? <TombsPanel tombstones={detail.tombstones} /> : null}

                {tab === "ops" ? <OpsPanel operations={detail.operations} /> : null}

                {tab === "algo" ? <AlgoLab /> : null}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* ================= Ngưỡng cấu hình — thông tin đọc ================= */}
      {overview !== null ? (
        <Card title="Ngưỡng cấu hình">
          <SettingsPanel settings={overview.settings} />
        </Card>
      ) : null}
    </div>
  );
}
