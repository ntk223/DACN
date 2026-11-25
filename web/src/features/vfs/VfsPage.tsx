import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { Tabs } from "@/components/Tabs";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { HistoryPanel } from "./HistoryPanel";
import { AlgoLab } from "./AlgoLab";
import { OpsPanel } from "./OpsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { TombsPanel } from "./TombsPanel";
import { ToastStack, useToasts } from "./Toast";
import { errorMessage, vfsApi } from "./vfsApi";
import { uploadOne } from "./upload";
import { WorkspaceList } from "./WorkspaceList";
import type { FileDetail, Overview, WorkspaceDetail } from "./types";
import "./vfs.css";

type VfsTab = "content" | "history" | "tombs" | "ops" | "algo";

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

/**
 * Trang quản lý VFS — port đầy đủ tương tác từ gateway/vfs.html:
 * cột trái (workspace + ngưỡng + cây file), cột phải (nội dung file / lịch sử /
 * dấu xóa / sổ thao tác / thuật toán), phím tắt N/R/Ctrl+S, upload theo phần.
 */
export function VfsPage() {
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

  const [tab, setTab] = useState<VfsTab>("content");
  const [treeFilter, setTreeFilter] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

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

  const selectWorkspace = useCallback(
    (id: string) => {
      if (dirtyRef.current && !window.confirm("Có thay đổi chưa lưu. Bỏ qua?")) return;
      markDirty(false);
      setWsId(id);
      setActivePath(null);
      setFileDetail(null);
      setFileError(null);
      setIsNew(false);
      setContent("");
      setTreeFilter("");
      setTab("content");
    },
    [markDirty],
  );

  const openFile = useCallback(
    (path: string) => {
      if (dirtyRef.current && !window.confirm("Có thay đổi chưa lưu. Bỏ qua?")) return;
      markDirty(false);
      setIsNew(false);
      setTab("content");
      if (path === activePath) {
        // Mở lại cùng file → ép fetch lại để chắc chắn đồng bộ.
        setFileVersion((v) => v + 1);
        return;
      }
      setActivePath(path);
      setFileDetail(null);
      setFileError(null);
    },
    [activePath, markDirty],
  );

  const newFile = useCallback(
    (prefill = "") => {
      if (dirtyRef.current && !window.confirm("Có thay đổi chưa lưu. Bỏ qua?")) return;
      markDirty(false);
      setIsNew(true);
      setActivePath(null);
      setFileDetail(null);
      setFileError(null);
      setNewPath(prefill);
      setContent("");
      setTab("content");
    },
    [markDirty],
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

  const doMove = useCallback(async () => {
    if (wsId === null || activePath === null) return;
    const dst = window.prompt("Đường dẫn mới:", activePath);
    if (dst === null || dst.trim().length === 0 || dst.trim() === activePath) return;
    setBusy(true);
    try {
      const result = await vfsApi.move(wsId, activePath, dst.trim());
      push(`Đã đổi tên → ${result.written.path} (nguồn để lại dấu xóa)`, "success");
      markDirty(false);
      setActivePath(result.written.path);
      bumpVersions();
    } catch (error) {
      push(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }, [wsId, activePath, push, markDirty, bumpVersions]);

  const reload = useCallback(async () => {
    await refreshOverview();
    if (wsId !== null) bumpVersions();
  }, [refreshOverview, wsId, bumpVersions]);

  const createWorkspace = useCallback(
    async (name: string, conflictPolicy: string) => {
      try {
        const result = await vfsApi.createWorkspace(name, conflictPolicy);
        push(`Đã tạo workspace ${result.workspace_id}`, "success");
        await refreshOverview();
        setWsId(result.workspace_id);
        setActivePath(null);
        setFileDetail(null);
        setIsNew(false);
      } catch (error) {
        push(errorMessage(error), "error");
      }
    },
    [push, refreshOverview],
  );

  const onUploadPicked = useCallback(
    async (files: FileList) => {
      if (wsId === null || overview === null) return;
      const inlineMax = overview.settings.inline_max_bytes;
      let last: string | null = null;
      for (const file of Array.from(files)) {
        const dir =
          activePath !== null && activePath.includes("/")
            ? activePath.slice(0, activePath.lastIndexOf("/") + 1)
            : "";
        const target = window.prompt(`Đường dẫn đích cho '${file.name}':`, dir + file.name);
        if (target === null || target.trim().length === 0) continue;
        try {
          last = await uploadOne(wsId, target.trim(), file, inlineMax, push);
        } catch (error) {
          push(`${file.name}: ${errorMessage(error)}`, "error");
        }
      }
      if (last !== null) {
        setActivePath(last);
        bumpVersions();
      }
    },
    [wsId, overview, activePath, push, bumpVersions],
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

  const wsTitle = detail !== null ? (detail.name ?? detail.workspace.id) : "Chưa chọn workspace";

  const tabItems = useMemo(
    () => [
      { key: "content" as const, label: "Nội dung file" },
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

  const fileBusy = busy || fileLoading;

  return (
    <div className="vfs-layout">
      <ToastStack toasts={toasts} />

      {/* ================= Cột trái ================= */}
      <div className="vfs-col">
        <Card title="Workspaces">
          {overviewError !== null ? (
            <EmptyState
              title="Không tải được danh sách"
              description={overviewError}
            >
              <Button size="sm" onClick={() => void refreshOverview()}>
                Thử lại
              </Button>
            </EmptyState>
          ) : overview === null ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
              <Spinner label="Đang tải workspace…" />
            </div>
          ) : (
            <WorkspaceList
              overview={overview}
              activeId={wsId}
              onSelect={selectWorkspace}
              onCreate={createWorkspace}
            />
          )}
        </Card>

        {overview !== null ? (
          <Card title="Ngưỡng cấu hình">
            <SettingsPanel settings={overview.settings} />
          </Card>
        ) : null}

        {detail !== null ? (
          <Card
            title={`Cây file — ${wsTitle}`}
            actions={
              <span className="vfs-row">
                <Button size="sm" onClick={() => newFile()} title="File mới (N)">
                  + File
                </Button>
                <Button size="sm" onClick={() => uploadInputRef.current?.click()} title="Upload từ máy (file lớn tự đi đường chunk)">
                  Upload
                </Button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files !== null && e.target.files.length > 0) void onUploadPicked(e.target.files);
                    e.target.value = "";
                  }}
                />
              </span>
            }
          >
            <input
              className="input"
              value={treeFilter}
              placeholder="lọc file…"
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
      </div>

      {/* ================= Cột phải ================= */}
      <div className="vfs-col">
        {wsId === null ? (
          <Card>
            <EmptyState
              title="Chưa chọn workspace"
              description="Chọn một workspace ở cột trái. Chưa có dữ liệu? Chạy `make seed`."
            />
          </Card>
        ) : (
          <Card title={wsTitle}>
            {detailError !== null ? (
              <EmptyState title="Không tải được workspace" description={detailError}>
                <Button size="sm" onClick={() => void reload()}>
                  Tải lại
                </Button>
              </EmptyState>
            ) : detail === null ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
                <Spinner label="Đang tải chi tiết…" />
              </div>
            ) : (
              <>
                <Tabs items={tabItems} active={tab} onChange={setTab} />

                {detailLoading ? <div style={{ marginTop: 8 }}><Spinner label="Đang làm mới…" /></div> : null}

                <div style={{ marginTop: 12 }}>
                  {tab === "content" ? (
                    fileError !== null ? (
                      <EmptyState title="Không mở được file" description={fileError}>
                        <Button size="sm" onClick={() => activePath !== null && openFile(activePath)}>
                          Thử lại
                        </Button>
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
                        onMove={() => void doMove()}
                        onDelete={() => setDeleteOpen(true)}
                        onToast={push}
                        onMutated={bumpVersions}
                      />
                    )
                  ) : null}

                  {tab === "history" ? (
                    <HistoryPanel
                      key={`${activePath ?? "none"}:${fileVersion}`}
                      wsId={wsId}
                      file={fileDetail}
                      isNew={isNew}
                      onToast={push}
                      onRefresh={bumpVersions}
                    />
                  ) : null}

                  {tab === "tombs" ? <TombsPanel tombstones={detail.tombstones} /> : null}

                  {tab === "ops" ? <OpsPanel operations={detail.operations} /> : null}

                  {tab === "algo" ? <AlgoLab /> : null}
                </div>
              </>
            )}
          </Card>
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
    </div>
  );
}
