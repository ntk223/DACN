import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { RecentOps } from "./RecentOps";
import { RenameModal } from "./RenameModal";
import { ToastStack, useToasts } from "./Toast";
import { UploadModal } from "./UploadModal";
import { quotaTone } from "./WorkspaceList";
import { WorkspaceInfoBar } from "./WorkspaceInfoBar";
import { errorMessage, vfsApi } from "./vfsApi";
import type { OpenSandboxOps, OpenVfsManage, VfsOpsRequest } from "@/lib/nav";
import type { FileDetail, Overview, WorkspaceDetail } from "./types";
import "./vfs.css";

/** Đang gõ trong input/textarea/select thì không bắt phím tắt N/R. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/** Thư mục đích mặc định khi upload: thư mục chứa file đang mở (nếu có). */
function dirOf(activePath: string | null): string {
  return activePath !== null && activePath.includes("/")
    ? activePath.slice(0, activePath.lastIndexOf("/") + 1)
    : "";
}

/** Hành động bị chặn vì có thay đổi chưa lưu — chờ người dùng xác nhận bỏ thay đổi. */
interface GuardedAction {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => void;
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

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [wsId, setWsId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileVersion, setFileVersion] = useState(0);

  const [isNew, setIsNew] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const [treeFilter, setTreeFilter] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [guard, setGuard] = useState<GuardedAction | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPolicy, setCreatePolicy] = useState("sandbox_wins");
  const [createBusy, setCreateBusy] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  /** Nonce của navRequest đã áp dụng — null nghĩa là chưa có yêu cầu điều hướng nào. */
  const lastNavNonceRef = useRef<number | null>(null);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const bumpVersions = useCallback(() => {
    setDetailVersion((v) => v + 1);
    setFileVersion((v) => v + 1);
  }, []);

  // ---- Lần đầu: tải overview và tự chọn workspace cuối (như trang cũ) ----
  useEffect(() => {
    let cancelled = false;
    vfsApi
      .overview()
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        // Có yêu cầu điều hướng từ trang Quản lý → effect bên dưới đã chọn
        // workspace theo yêu cầu, không tự chọn workspace cuối nữa.
        if (lastNavNonceRef.current !== null) return;
        if (data.workspaces.length > 0) {
          const last = data.workspaces[data.workspaces.length - 1];
          if (last !== undefined) setWsId(last.id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setOverviewError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Chi tiết workspace khi chọn / khi cần refresh ----
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

  // ---- Chi tiết file khi mở / refresh ----
  useEffect(() => {
    if (wsId === null || activePath === null || isNew) return;
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    vfsApi
      .file(wsId, activePath)
      .then((data) => {
        if (cancelled) return;
        setFileDetail(data);
        setContent(data.encoding === "utf-8" ? (data.content ?? "") : "");
        markDirty(false);
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
  }, [wsId, activePath, fileVersion, isNew, markDirty]);

  // ---- Hành động ----
  const refreshOverview = useCallback(async (): Promise<Overview | null> => {
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

  /** Có thay đổi chưa lưu → mở ConfirmDialog hỏi bỏ thay đổi, không dùng window.confirm. */
  const askDiscard = useCallback((action: () => void) => {
    if (dirtyRef.current) {
      setGuard({
        title: "Thay đổi chưa lưu",
        message: "Nội dung đang sửa chưa được lưu. Bỏ qua thay đổi và tiếp tục?",
        confirmLabel: "Bỏ thay đổi",
        action,
      });
      return;
    }
    action();
  }, []);

  /** Tạo workspace từ modal "+ Workspace": gọi API → refresh danh sách → chọn workspace mới. */
  const submitCreateWorkspace = useCallback(async () => {
    if (createBusy) return;
    setCreateBusy(true);
    try {
      const result = await vfsApi.createWorkspace(createName.trim(), createPolicy);
      push(`Đã tạo workspace ${result.workspace_id}`, "success");
      setCreateOpen(false);
      setCreateName("");
      setCreatePolicy("sandbox_wins");
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
        setWsId(result.workspace_id);
      });
    } catch (error) {
      push(errorMessage(error), "error");
    } finally {
      setCreateBusy(false);
    }
  }, [createBusy, createName, createPolicy, push, refreshOverview, askDiscard, markDirty]);

  // ---- Yêu cầu "Quản lý → Thao tác": chọn workspace/file theo navRequest ----
  // Chỉ phản ứng khi nonce mới xuất hiện; vào trang qua sidebar (navRequest cũ
  // hoặc không có) thì giữ nguyên lựa chọn hiện tại.
  useEffect(() => {
    if (navRequest === undefined) return;
    const { nonce, workspaceId, file } = navRequest;
    if (workspaceId === undefined) return;
    if (nonce === lastNavNonceRef.current) return;
    lastNavNonceRef.current = nonce;

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
  }, [navRequest, wsId, activePath, askDiscard, markDirty]);

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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "n" || event.key === "N") {
        if (wsId !== null) {
          event.preventDefault();
          newFile();
        }
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void reload();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [wsId, newFile, reload]);

  // ---- Cảnh báo rời trang khi có thay đổi chưa lưu ----
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

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

  const fileBusy = busy || fileLoading;

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
                  <div className="vfs-bar">
                    <div style={{ width: `${Math.min(100, quotaPct)}%`, background: quotaTone(used, quota) }} />
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
                  busy={fileBusy}
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

      <ConfirmDialog
        open={guard !== null}
        title={guard?.title ?? ""}
        message={guard?.message ?? ""}
        confirmLabel={guard?.confirmLabel ?? "Xác nhận"}
        busy={false}
        onConfirm={() => {
          const action = guard?.action;
          setGuard(null);
          action?.();
        }}
        onClose={() => setGuard(null)}
      />

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

      <Modal
        open={createOpen}
        title="Tạo workspace"
        onClose={() => (createBusy ? undefined : setCreateOpen(false))}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="vfs-small vfs-dim" htmlFor="vfs-create-name">
              Tên (tuỳ chọn — để trống sẽ tự sinh id)
            </label>
            <input
              id="vfs-create-name"
              className="input"
              value={createName}
              placeholder="vd: demo-notes"
              autoFocus
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreateWorkspace();
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="vfs-small vfs-dim" htmlFor="vfs-create-policy">
              Chính sách xung đột ghi
            </label>
            <select
              id="vfs-create-policy"
              className="select"
              value={createPolicy}
              onChange={(e) => setCreatePolicy(e.target.value)}
            >
              <option value="sandbox_wins">sandbox_wins</option>
              <option value="error">error</option>
            </select>
          </div>
          <div className="vfs-row" style={{ justifyContent: "flex-end" }}>
            <Button
              size="sm"
              disabled={createBusy}
              onClick={() => (createBusy ? undefined : setCreateOpen(false))}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={createBusy}
              onClick={() => void submitCreateWorkspace()}
            >
              Tạo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
