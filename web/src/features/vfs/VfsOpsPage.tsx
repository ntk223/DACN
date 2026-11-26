import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ToastStack, useToasts } from "@/components/Toast";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { RecentOps } from "./RecentOps";
import { RenameModal } from "./RenameModal";
import { UploadModal } from "./UploadModal";
import { quotaColor } from "./WorkspaceList";
import { WorkspaceInfoBar } from "./WorkspaceInfoBar";
import { useDirtyState } from "./useDirtyState";
import { useFileDetail, useVfsOverview, useWorkspaceDetail } from "./useVfsData";
import { useVfsShortcuts } from "./useVfsShortcuts";
import { errorMessage, vfsApi } from "./vfsApi";
import { useNavEffect } from "@/lib/nav";
import type { OpenSandboxOps, OpenVfsManage, VfsOpsRequest } from "@/lib/nav";
import "./vfs.css";

/** Thư mục đích mặc định khi upload: thư mục chứa file đang mở (nếu có). */
function dirOf(activePath: string | null): string {
  return activePath !== null && activePath.includes("/")
    ? activePath.slice(0, activePath.lastIndexOf("/") + 1)
    : "";
}

/**
 * Trang VFS · Thao tác — việc hằng ngày: chọn workspace qua quick-switcher gọn,
 * cây file cột trái hẹp, toàn bộ diện tích còn lại dành cho trình sửa file.
 * Trên editor là thanh thông tin workspace (policy, thống kê, hạn mức, phiên
 * đang chạy + đường nhanh "Sang Sandbox"); dưới cây file là sổ thao tác gần đây
 * ("Xem tất cả" → trang Quản lý); trong editor có nút "Lịch sử" mở lịch sử chỉnh sửa
 * của file ngay tại chỗ (modal).
 * Phím tắt N (file mới) / R (tải lại) / Ctrl+S (lưu, do FileEditor xử lý).
 * Lịch sử / dấu xóa / sổ thao tác / thuật toán / ngưỡng cấu hình nằm ở trang Quản lý.
 * Nhận `navRequest` từ App: bấm item ở trang Quản lý → mở đúng workspace/file đó.
 */
interface VfsOpsPageProps {
  navRequest?: VfsOpsRequest;
  /** Đường nhanh sang trang Quản lý (Sổ thao tác gần đây). */
  onOpenManage?: OpenVfsManage;
  /** Đường nhanh sang Sandbox · Thao tác cho phiên đang gắn workspace. */
  onOpenSandboxOps?: OpenSandboxOps;
}

export function VfsOpsPage({ navRequest, onOpenManage, onOpenSandboxOps }: VfsOpsPageProps) {
  const { toasts, push } = useToasts();

  const [wsId, setWsId] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [fileVersion, setFileVersion] = useState(0);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [content, setContent] = useState("");
  const { dirty, markDirty, askDiscard, guardProps } = useDirtyState();
  const [busy, setBusy] = useState(false);

  const [treeFilter, setTreeFilter] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  /** Đã có yêu cầu điều hướng được áp dụng — chặn auto-select workspace cuối. */
  const navAppliedRef = useRef(false);

  const bumpVersions = useCallback(() => {
    setDetailVersion((v) => v + 1);
    setFileVersion((v) => v + 1);
  }, []);

  // ---- Dữ liệu: overview / chi tiết workspace / chi tiết file (hook dùng chung) ----
  const { overview, overviewError, refresh: refreshOverview } = useVfsOverview(
    navAppliedRef,
    setWsId,
  );
  const {
    detail,
    loading: detailLoading,
    error: detailError,
  } = useWorkspaceDetail(wsId, detailVersion);
  const {
    file: fileDetail,
    setFile: setFileDetail,
    loading: fileLoading,
    error: fileError,
    setError: setFileError,
  } = useFileDetail(wsId, activePath, isNew, fileVersion, (data) => {
    setContent(data.encoding === "utf-8" ? (data.content ?? "") : "");
    markDirty(false);
  });

  // ---- Hành động ----
  /** Modal tạo workspace báo thành công: refresh danh sách + chọn workspace mới. */
  const handleWorkspaceCreated = useCallback(
    async (workspaceId: string) => {
      await refreshOverview();
      askDiscard(() => {
        markDirty(false);
        setIsNew(false);
        setContent("");
        setNewPath("");
        setActivePath(null);
        setFileDetail(null);
        setFileError(null);
        setTreeFilter("");
        setWsId(workspaceId);
      });
    },
    [refreshOverview, askDiscard, markDirty],
  );

  // ---- Yêu cầu "Quản lý → Thao tác": chọn workspace/file theo navRequest ----
  // useNavEffect: chỉ chạy khi nonce MỚI hơn lần đã xử lý; vào trang qua sidebar
  // (navRequest cũ hoặc không có) thì giữ nguyên lựa chọn hiện tại.
  useNavEffect(navRequest, (req) => {
    const { workspaceId, file } = req;
    if (workspaceId === undefined) return;
    navAppliedRef.current = true;

    askDiscard(() => {
      markDirty(false);
      setIsNew(false);
      setTreeFilter("");
      setFileError(null);
      if (workspaceId !== wsId) {
        setWsId(workspaceId);
        setActivePath(null);
        setFileDetail(null);
      }
      if (file !== undefined) {
        if (workspaceId === wsId && file === activePath) {
          // Cùng file đang mở → ép fetch lại để chắc chắn đồng bộ.
          setFileVersion((v) => v + 1);
        } else {
          setActivePath(file);
          setFileDetail(null);
        }
      }
    });
  });

  const selectWorkspace = useCallback(
    (id: string) => {
      if (id === wsId) return;
      askDiscard(() => {
        markDirty(false);
        setWsId(id);
        setActivePath(null);
        setFileDetail(null);
        setFileError(null);
        setIsNew(false);
        setContent("");
        setTreeFilter("");
      });
    },
    [wsId, askDiscard, markDirty],
  );

  const openFile = useCallback(
    (path: string) => {
      askDiscard(() => {
        markDirty(false);
        setIsNew(false);
        if (path === activePath) {
          // Mở lại cùng file → ép fetch lại để chắc chắn đồng bộ.
          setFileVersion((v) => v + 1);
          return;
        }
        setActivePath(path);
        setFileDetail(null);
        setFileError(null);
      });
    },
    [activePath, askDiscard, markDirty],
  );

  const newFile = useCallback(
    (prefill = "") => {
      askDiscard(() => {
        markDirty(false);
        setIsNew(true);
        setActivePath(null);
        setFileDetail(null);
        setFileError(null);
        setNewPath(prefill);
        setContent("");
      });
    },
    [askDiscard, markDirty],
  );

  const saveFile = useCallback(async () => {
    if (wsId === null || busy) return;
    const path = (isNew ? newPath : (activePath ?? "")).trim();
    if (path.length === 0) {
      push("Nhập đường dẫn file", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await vfsApi.write(wsId, path, content);
      push(
        result.noop
          ? "Không đổi (cùng sha) — no-op, revision giữ nguyên"
          : `Đã lưu ${result.path} · rev ${result.rev}`,
        result.noop ? "warn" : "success",
      );
      markDirty(false);
      if (isNew) setIsNew(false);
      setActivePath(path);
      bumpVersions();
    } catch (error) {
      push(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }, [wsId, busy, isNew, newPath, activePath, content, push, markDirty, bumpVersions]);

  const doDelete = useCallback(async () => {
    if (wsId === null || activePath === null) return;
    setBusy(true);
    try {
      const result = await vfsApi.remove(wsId, activePath);
      push(`Đã xóa ${result.path} · rev ${result.rev} · dấu xóa đã ghi`, "success");
      markDirty(false);
      setDeleteOpen(false);
      setActivePath(null);
      setFileDetail(null);
      bumpVersions();
    } catch (error) {
      push(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }, [wsId, activePath, push, markDirty, bumpVersions]);

  /** Xác nhận từ RenameModal — hành vi move giữ nguyên như bản cũ. */
  const doMove = useCallback(
    async (dst: string) => {
      if (wsId === null || activePath === null) return;
      setBusy(true);
      try {
        const result = await vfsApi.move(wsId, activePath, dst);
        push(`Đã đổi tên → ${result.written.path} (nguồn để lại dấu xóa)`, "success");
        markDirty(false);
        setRenameOpen(false);
        setActivePath(result.written.path);
        bumpVersions();
      } catch (error) {
        push(errorMessage(error), "error");
      } finally {
        setBusy(false);
      }
    },
    [wsId, activePath, push, markDirty, bumpVersions],
  );

  const reload = useCallback(async () => {
    await refreshOverview();
    if (wsId !== null) bumpVersions();
  }, [refreshOverview, wsId, bumpVersions]);

  /** Chọn file từ máy → mở modal upload (không prompt từng file như bản cũ). */
  const onUploadPicked = useCallback((files: FileList) => {
    if (files.length === 0) return;
    setUploadFiles(Array.from(files));
  }, []);

  /** Modal upload báo xong: mở file cuối cùng đã ghi + refresh cây. */
  const onUploadDone = useCallback(
    (lastPath: string | null) => {
      setUploadFiles(null);
      if (lastPath !== null) {
        setActivePath(lastPath);
        bumpVersions();
      }
    },
    [bumpVersions],
  );

  // ---- Phím tắt toàn cục: N (file mới), R (tải lại). Ctrl+S do FileEditor xử lý. ----
  useVfsShortcuts({ wsId, onNewFile: newFile, onReload: reload });

  const filteredFiles = useMemo(() => {
    const files = detail?.files ?? [];
    const query = treeFilter.trim().toLowerCase();
    if (query.length === 0) return files;
    return files.filter((f) => f.path.toLowerCase().includes(query));
  }, [detail, treeFilter]);

  /** Workspace đang chọn (để hiển thị hạn mức trong quick-switcher). */
  const activeItem = useMemo(
    () => overview?.workspaces.find((w) => w.id === wsId) ?? null,
    [overview, wsId],
  );

  const quota = overview?.settings.workspace_quota_bytes ?? 0;
  const used = activeItem?.used_bytes ?? 0;
  const quotaPct = quota > 0 ? (used / quota) * 100 : 0;

  return (
    <div className="vfs-layout vfs-layout--ops">
      <ToastStack toasts={toasts} />

      {/* ================= Cột trái hẹp: quick-switcher + cây file ================= */}
      <div className="vfs-col">
        <Card
          title="Workspace"
          actions={
            <Button
              size="sm"
              variant="primary"
              title="Tạo workspace mới"
              onClick={() => setCreateOpen(true)}
            >
              + Workspace
            </Button>
          }
        >
          {overviewError !== null ? (
            <EmptyState title="Không tải được danh sách" description={overviewError}>
              <Button size="sm" onClick={() => void refreshOverview()}>
                Thử lại
              </Button>
            </EmptyState>
          ) : overview === null ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
              <Spinner label="Đang tải workspace…" />
            </div>
          ) : overview.workspaces.length === 0 ? (
            <EmptyState
              title="Chưa có workspace"
              description="Bấm + Workspace ở trên để tạo mới, hoặc chạy `make seed`."
            />
          ) : (
            <>
              <select
                className="select"
                value={wsId ?? ""}
                onChange={(e) => selectWorkspace(e.target.value)}
                aria-label="Chọn workspace"
              >
                {overview.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name ?? w.id}
                  </option>
                ))}
              </select>
              {activeItem !== null ? (
                <div
                  className="vfs-ws-quota"
                  style={{ marginTop: 8 }}
                  title={`${quotaPct.toFixed(1)}% hạn mức`}
                >
                  <div className="meter">
                    <div style={{ width: `${Math.min(100, quotaPct)}%`, background: quotaColor(used, quota) }} />
                  </div>
                  <span className="vfs-ws-pct">{quotaPct.toFixed(0)}%</span>
                </div>
              ) : null}
            </>
          )}
        </Card>

        {detail !== null ? (
          <Card
            title="Cây file"
            actions={
              <span className="vfs-row">
                <Button size="sm" onClick={() => newFile()} title="File mới (N)">
                  + File
                </Button>
                <Button
                  size="sm"
                  onClick={() => uploadInputRef.current?.click()}
                  title="Upload từ máy (file lớn tự đi đường chunk)"
                >
                  Upload
                </Button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files !== null) onUploadPicked(e.target.files);
                    e.target.value = "";
                  }}
                />
              </span>
            }
          >
            <input
              className="input"
              value={treeFilter}
              placeholder="Lọc theo đường dẫn…"
              aria-label="Lọc cây file"
              onChange={(e) => setTreeFilter(e.target.value)}
            />
            <FileTree
              files={detail.files}
              filtered={filteredFiles}
              activePath={activePath}
              onOpen={openFile}
            />
          </Card>
        ) : null}

        {detail !== null && wsId !== null && onOpenManage !== undefined ? (
          <RecentOps operations={detail.operations} onViewAll={() => onOpenManage(wsId)} />
        ) : null}
      </div>

      {/* ================= Cột phải: trình sửa file là nhân vật chính ================= */}
      <div className="vfs-col">
        {wsId === null ? (
          <Card>
            <EmptyState
              title="Chưa có workspace"
              description="Chọn workspace ở cột trái (hoặc bấm + Workspace để tạo mới) để bắt đầu sửa file."
            >
              <ul className="vfs-hints">
                <li>Chưa có dữ liệu? Chạy <span className="kbd">make seed</span> để tạo dữ liệu mẫu.</li>
                <li>Phím <span className="kbd">R</span> — tải lại danh sách workspace.</li>
              </ul>
            </EmptyState>
          </Card>
        ) : detailError !== null ? (
          <Card>
            <EmptyState title="Không tải được workspace" description={detailError}>
              <Button size="sm" onClick={() => void reload()}>
                Tải lại
              </Button>
            </EmptyState>
          </Card>
        ) : detail === null ? (
          <Card>
            <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
              <Spinner label="Đang tải chi tiết…" />
            </div>
          </Card>
        ) : (
          <>
            {/* Thanh thông tin workspace: policy, thống kê, hạn mức, phiên + "Sang Sandbox". */}
            <WorkspaceInfoBar detail={detail} onOpenSandboxOps={onOpenSandboxOps} />

            <Card>
              {detailLoading ? (
                <div style={{ marginBottom: 8 }}>
                  <Spinner label="Đang làm mới…" />
                </div>
              ) : null}

              {fileError !== null && !isNew ? (
                <EmptyState title="Không mở được file" description={fileError}>
                  <Button size="sm" onClick={() => activePath !== null && openFile(activePath)}>
                    Thử lại
                  </Button>
                </EmptyState>
              ) : !isNew && activePath === null ? (
                <EmptyState
                  title="Chưa chọn file"
                  description="Chọn file ở cây bên trái, hoặc N để tạo file mới."
                >
                  <ul className="vfs-hints">
                    <li>Phím <span className="kbd">N</span> — tạo file mới.</li>
                    <li>Phím <span className="kbd">Ctrl+S</span> — lưu, <span className="kbd">R</span> — tải lại.</li>
                    <li>Chọn file từ máy? Bấm <b>Upload</b> phía trên cây file.</li>
                  </ul>
                </EmptyState>
              ) : (
                <FileEditor
                  wsId={wsId}
                  file={fileDetail}
                  isNew={isNew}
                  dirty={dirty}
                  busy={busy || fileLoading}
                  newPath={newPath}
                  content={content}
                  onNewPathChange={setNewPath}
                  onContentChange={(value) => {
                    setContent(value);
                    markDirty(true);
                  }}
                  onSave={() => void saveFile()}
                  onMove={() => setRenameOpen(true)}
                  onDelete={() => setDeleteOpen(true)}
                  onToast={push}
                  onMutated={bumpVersions}
                />
              )}
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Xóa file"
        message={`Xóa '${activePath ?? ""}'? File sẽ để lại một dấu xóa (tombstone) trong workspace.`}
        confirmLabel="Xóa"
        danger
        busy={busy}
        onConfirm={() => void doDelete()}
        onClose={() => (busy ? undefined : setDeleteOpen(false))}
      />

      <ConfirmDialog {...guardProps} />

      {activePath !== null ? (
        <RenameModal
          open={renameOpen}
          path={activePath}
          busy={busy}
          onConfirm={(dst) => void doMove(dst)}
          onClose={() => (busy ? undefined : setRenameOpen(false))}
        />
      ) : null}

      {overview !== null ? (
        <UploadModal
          open={uploadFiles !== null}
          wsId={wsId}
          files={uploadFiles ?? []}
          initialDir={dirOf(activePath)}
          inlineMaxBytes={overview.settings.inline_max_bytes}
          onClose={() => (uploadFiles !== null ? setUploadFiles(null) : undefined)}
          onDone={onUploadDone}
          onToast={push}
        />
      ) : null}

      <CreateWorkspaceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onToast={push}
        onCreated={handleWorkspaceCreated}
      />
    </div>
  );
}
