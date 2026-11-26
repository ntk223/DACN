/**
 * SandboxOpsPage.tsx — trang THAO TÁC sandbox: mọi thao tác vòng đời tập trung tại đây.
 * Trái: danh sách phiên (kể cả STANDBY/STARTING để bật ngay). Phải: banner theo
 * trạng thái (Bật qua StartModal / đang bật) + thanh hành động (Tạm dừng /
 * Tiếp tục / Gia hạn qua RenewModal / Dừng & xóa qua ConfirmDialog) + tabs
 * Chạy lệnh / File / Log / Đồng bộ / Kiểm tra lệnh / Thông tin.
 * Nhận navRequest từ trang Quản lý (chọn đúng phiên được yêu cầu). Tự làm mới
 * 5 giây — tạm dừng khi lệnh exec đang chạy / người dùng đang gõ / modal mở.
 */
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { StateBadge } from "@/components/StateBadge";
import { Tabs } from "@/components/Tabs";
import { ToastStack, useToasts } from "@/components/Toast";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { providerTone } from "@/lib/format";
import type { SandboxOpsRequest } from "@/lib/nav";
import { ExecConsole } from "./ExecConsole";
import { FileBrowser } from "./FileBrowser";
import { LoadErrorBanner, LoadErrorCard, useSandboxData } from "./SandboxData";
import { LogsPanel } from "./LogsPanel";
import { NotReadyPanel } from "./NotReadyPanel";
import { PolicyPanel } from "./PolicyPanel";
import { RenewModal } from "./RenewModal";
import { SandboxDetail } from "./SandboxDetail";
import { SyncBadge, ttlUrgency } from "./SandboxTable";
import { sandboxApi } from "./sandboxApi";
import { StartModal } from "./StartModal";
import { SyncPanel } from "./SyncPanel";
import "./sandbox.css";
import type { ProviderCapabilities, SessionRow, StartResult } from "./types";
import { remainLabel } from "./util";

type TabKey = "exec" | "files" | "logs" | "sync" | "policy" | "info";

/** Nhãn ngắn cho badge trạng thái item cột trái (đè nhãn mặc định của StateBadge). */
const ITEM_STATE_LABEL: Partial<Record<SessionRow["state"], string>> = {
  STARTING: "đang bật",
  STANDBY: "chưa bật",
};

export function SandboxOpsPage({ navRequest }: { navRequest?: SandboxOpsRequest }) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [execBusy, setExecBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const { toasts, push } = useToasts();

  const { overview, error, refreshing, selectedId, setSelectedId, detail, detailLoading, reloadAll, typingProps } =
    useSandboxData(!autoRefresh || execBusy || modalOpen);

  // ---- Điều hướng từ trang Quản lý (navRequest theo nonce) ----
  const [navSessionId, setNavSessionId] = useState<string | null>(null);
  const handledNonceRef = useRef<number | null>(null);

  // Ghi nhận yêu cầu mới theo nonce — bỏ qua request cũ / lặp giá trị.
  useEffect(() => {
    if (!navRequest || handledNonceRef.current === navRequest.nonce) return;
    handledNonceRef.current = navRequest.nonce;
    setNavSessionId(navRequest.sessionId);
  }, [navRequest]);

  // Phiên có sandbox (đang hoạt động) ở cột trái.
  const activeSessions =
    overview?.sessions.filter((s) => (s.state === "RUNNING" || s.state === "PAUSED") && s.sandbox_id) ?? [];

  // Xử lý yêu cầu điều hướng khi overview đã tải: chọn sandbox_id nếu đã có,
  // còn STANDBY/STARTING thì chọn theo session_id (khối Bật/xem).
  useEffect(() => {
    if (navSessionId === null || overview === null) return;
    const target = overview.sessions.find((s) => s.session_id === navSessionId) ?? null;
    if (target !== null) {
      if (target.sandbox_id) setSelectedId(target.sandbox_id);
      else setNotReadySessionId(target.session_id);
    }
    setNavSessionId(null);
  }, [navSessionId, overview, setSelectedId]);

  // ---- Chọn phiên chưa có sandbox (STANDBY/STARTING) — tách khỏi sandbox_id ----
  const [notReadySessionId, setNotReadySessionId] = useState<string | null>(null);
  const notReadySession =
    overview?.sessions.find(
      (s) => s.session_id === notReadySessionId && (s.state === "STANDBY" || s.state === "STARTING"),
    ) ?? null;

  // Phiên đang chọn "chưa bật" vừa có sandbox → chuyển sang chọn sandbox như thường.
  useEffect(() => {
    if (notReadySessionId === null) return;
    const row = overview?.sessions.find((s) => s.session_id === notReadySessionId);
    if (row?.sandbox_id) {
      setNotReadySessionId(null);
      setSelectedId(row.sandbox_id);
    }
  }, [overview, notReadySessionId, setSelectedId]);

  /** Chọn 1 item ở cột trái — đồng thời hủy yêu cầu điều hướng đang chờ. */
  const selectItem = (row: SessionRow) => {
    setNavSessionId(null);
    setNotReadySessionId(null);
    setStopConflict(null);
    if (row.sandbox_id) setSelectedId(row.sandbox_id);
    else {
      setSelectedId(null);
      setNotReadySessionId(row.session_id);
    }
  };

  const session = activeSessions.find((s) => s.sandbox_id === selectedId) ?? null;

  /** Phiên RUNNING — điều kiện để exec/sync chạy thật (PAUSED → khóa). */
  const runningSession = session !== null && session.state === "RUNNING" ? session : null;

  // ---- Thanh hành động phiên: pause/resume/stop/renew ----
  const [busyAction, setBusyAction] = useState(false);
  const [renewTarget, setRenewTarget] = useState<SessionRow | null>(null);
  const [startTarget, setStartTarget] = useState<SessionRow | null>(null);
  /** Thông báo khi stop bị gate chống mất dữ liệu chặn (lỗi conflict) — cảnh báo inline. */
  const [stopConflict, setStopConflict] = useState<string | null>(null);
  // Xác nhận phá hủy qua ConfirmDialog dùng chung: "plain" = dừng & xóa, "force" = bỏ thay đổi.
  const [confirmStop, setConfirmStop] = useState<null | "plain" | "force">(null);

  /**
   * Chạy một thao tác vòng đời (pause/resume/stop) — cờ busy tránh bấm đôi.
   * stop bị chặn vì có thay đổi chưa nhận về kho (conflict) → không toast lỗi mà
   * hiện cảnh báo inline với nút "Dừng & bỏ thay đổi" (force).
   */
  const runLifecycle = async (action: "pause" | "resume" | "stop", force = false) => {
    if (!session || busyAction) return;
    setBusyAction(true);
    setStopConflict(null);
    try {
      if (action === "pause") await sandboxApi.pause(session.session_id);
      else if (action === "resume") await sandboxApi.resume(session.session_id);
      else await sandboxApi.stop(session.session_id, force);
      push(
        action === "stop"
          ? force ? "Đã dừng (bỏ thay đổi) — sandbox và volume đã xóa" : "Đã dừng — sandbox và volume đã xóa"
          : `Phiên → ${action === "pause" ? "tạm dừng" : "chạy lại"}`,
      );
    } catch (err) {
      if (action === "stop" && err instanceof ApiError && err.code === "conflict") {
        setStopConflict(err.message);
      } else {
        push(err instanceof Error ? err.message : "Thao tác thất bại", "error");
      }
    } finally {
      setBusyAction(false);
      reloadAll();
    }
  };

  const capabilities: ProviderCapabilities = overview?.capabilities ?? {};

  const tabItems: ReadonlyArray<{ key: TabKey; label: ReactNode }> = [
    {
      key: "exec",
      label: (
        <>
          Chạy lệnh
          {execBusy ? <span className="sbx-tab-dot" title="Đang chạy lệnh…" aria-hidden="true" /> : null}
        </>
      ),
    },
    { key: "files", label: "File /workspace" },
    { key: "logs", label: "Log" },
    { key: "sync", label: "Đồng bộ" },
    { key: "policy", label: "Kiểm tra lệnh" },
    { key: "info", label: "Thông tin" },
  ];
  const [tab, setTab] = useState<TabKey>("exec");
  const activeTab = tabItems.some((item) => item.key === tab) ? tab : "exec";

  if (error !== null && overview === null) {
    // Chưa có dữ liệu lần nào — hiển thị toàn màn (kèm hướng dẫn khi thiếu Docker).
    return (
      <>
        <LoadErrorCard error={error} onRetry={reloadAll} />
        <ToastStack toasts={toasts} />
      </>
    );
  }

  // Danh sách cột trái: sandbox hoạt động trước, rồi STARTING, rồi STANDBY.
  const listSessions = [
    ...activeSessions,
    ...(overview?.sessions.filter((s) => s.state === "STARTING") ?? []),
    ...(overview?.sessions.filter((s) => s.state === "STANDBY") ?? []),
  ];
  const liveCount = activeSessions.length;

  /** item cột trái đang được chọn (kể cả phiên chưa có sandbox). */
  const isItemSelected = (row: SessionRow): boolean =>
    row.sandbox_id
      ? row.sandbox_id === selectedId && notReadySessionId === null
      : notReadySessionId === row.session_id;

  return (
    <div {...typingProps}>
      {error !== null ? <LoadErrorBanner message={error.message} /> : null}

      <div className="sbx-ops-layout">
        {/* ---- Cột trái hẹp: danh sách phiên (kể cả chưa bật sandbox) ---- */}
        <Card
          title="Phiên & sandbox"
          actions={
            <span className="sbx-badges">
              {refreshing ? (
                <span className="sbx-meta sbx-refreshing" role="status" aria-live="polite">
                  đang cập nhật…
                </span>
              ) : null}
              <Badge title="Số phiên đang có sandbox hoạt động">{liveCount}</Badge>
            </span>
          }
        >
          {listSessions.length === 0 ? (
            <EmptyState title="Không có phiên nào">
              Tạo workspace ở trang Quản lý VFS để bắt đầu.
            </EmptyState>
          ) : (
            <div className="sbx-ops-list">
              {listSessions.map((row) => {
                const active = isItemSelected(row);
                return (
                  <button
                    key={row.session_id}
                    type="button"
                    className={`sbx-ops-item${active ? " sbx-ops-item-active" : ""}`}
                    onClick={() => selectItem(row)}
                  >
                    <span className="sbx-badges">
                      {row.sandbox_id ? (
                        <span className="sbx-mono" style={{ fontWeight: 600 }}>{row.sandbox_id}</span>
                      ) : (
                        <span className="sbx-meta" style={{ fontWeight: 600 }}>
                          {row.workspace_name ?? row.workspace_id}
                        </span>
                      )}
                      <StateBadge state={row.state} label={ITEM_STATE_LABEL[row.state]} />
                    </span>
                    <span className="sbx-badges">
                      {row.sandbox_id && row.sync ? <SyncBadge sync={row.sync} /> : null}
                      {row.sandbox_id ? (
                        <span className={`sbx-ttl${ttlUrgency(row.expires_at)}`}>
                          {remainLabel(row.expires_at)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Điều khiển auto-refresh đặt cuối cột trái — không chiếm không gian item */}
          <div className="sbx-toolbar" style={{ marginTop: 12 }}>
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
        </Card>

        {/* ---- Cột phải: thao tác trên phiên đã chọn ---- */}
        <div className="sbx-col">
          {notReadySession !== null ? (
            // Phiên chưa có sandbox: STANDBY (bật ngay tại đây) / STARTING (đang chờ).
            <NotReadyPanel
              session={notReadySession}
              onStart={(row) => { setStartTarget(row); setModalOpen(true); }}
            />
          ) : selectedId !== null && session !== null ? (
            <>
              <Card
                title={<span className="sbx-title-mono">{selectedId}</span>}
                actions={
                  <span className="sbx-meta">
                    {detailLoading && !detail
                      ? "đang tải…"
                      : `workspace ${session.workspace_name ?? session.workspace_id}`}
                  </span>
                }
              >
                {/* Thanh hành động phiên — nơi thao tác vòng đời chính */}
                <div className="sbx-action-bar">
                  <span className="sbx-badges">
                    <StateBadge state={session.state} />
                    <Badge tone={providerTone(session.provider_state)} title="Trạng thái thật theo provider (Docker)">
                      thực tế: {session.provider_state ?? "mất"}
                    </Badge>
                    {session.drift ? (
                      <Badge
                        tone="red"
                        title="Lệch sổ: trạng thái ghi sổ trong DB khác với thực tế của provider (Docker). Kiểm tra lại phiên, hoặc dừng & bật lại để đồng bộ."
                      >
                        ⚠ Lệch sổ
                      </Badge>
                    ) : null}
                    <span className={`sbx-ttl${ttlUrgency(session.expires_at)}`}>
                      {remainLabel(session.expires_at)}
                    </span>
                  </span>
                  {session.state === "PAUSED" ? (
                    <span className="sbx-meta" style={{ color: "var(--color-warning)" }}>
                      Đang tạm dừng — Tiếp tục để chạy lệnh, đồng bộ và xem file mới nhất.
                    </span>
                  ) : null}
                  <span className="spacer" />
                  {/* Hành động theo trạng thái */}
                  {session.state === "RUNNING" ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyAction || capabilities.pause_resume === false}
                      title="Tạm dừng container (pause)"
                      onClick={() => void runLifecycle("pause")}
                    >
                      Tạm dừng
                    </Button>
                  ) : null}
                  {session.state === "PAUSED" ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyAction}
                      title="Chạy lại container (resume)"
                      onClick={() => void runLifecycle("resume")}
                    >
                      Tiếp tục
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={busyAction}
                    title="Gia hạn thời hạn TTL của phiên"
                    onClick={() => {
                      setRenewTarget(session);
                      setModalOpen(true);
                    }}
                  >
                    Gia hạn
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="sbx-btn-danger-ghost"
                    disabled={busyAction}
                    title="Dừng phiên, XÓA sandbox và volume (file trong kho VFS không mất)"
                    onClick={() => setConfirmStop("plain")}
                  >
                    Dừng &amp; xóa
                  </Button>
                </div>

                {stopConflict !== null ? (
                  <div className="sbx-banner-warn" role="alert" style={{ marginTop: 12 }}>
                    <span>
                      <b>Sandbox có thay đổi chưa nhận về kho.</b> {stopConflict} Hãy vào tab{" "}
                      <b>Đồng bộ</b> bấm <b>Nhận về kho</b> trước khi dừng, hoặc dừng luôn và{" "}
                      <b>MẤT</b> các thay đổi này trong sandbox.
                    </span>
                    <span className="sbx-toolbar" style={{ marginTop: 8 }}>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyAction}
                        title="Bỏ qua gate chống mất dữ liệu — hủy sandbox và MẤT các thay đổi chưa nhận về"
                        onClick={() => setConfirmStop("force")}
                      >
                        Dừng &amp; bỏ thay đổi
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyAction} onClick={() => setStopConflict(null)}>
                        Để nguyên
                      </Button>
                    </span>
                  </div>
                ) : null}

                {detailLoading && !detail ? (
                  <Spinner label="Đang tải thông tin container…" />
                ) : (
                  <>
                    <Tabs items={tabItems} active={activeTab} onChange={setTab} />
                    <div style={{ paddingTop: 12 }}>
                      {activeTab === "exec" ? (
                        <ExecConsole
                          sessionId={runningSession?.session_id ?? null}
                          running={runningSession !== null}
                          onBusyChange={setExecBusy}
                          notify={push}
                        />
                      ) : null}
                      {activeTab === "files" ? (
                        <FileBrowser sandboxId={selectedId} listing={detail?.workspace} notify={push} />
                      ) : null}
                      {activeTab === "logs" ? (
                        <LogsPanel
                          sandboxId={selectedId}
                          supported={capabilities.diagnostics !== false}
                          notify={push}
                        />
                      ) : null}
                      {activeTab === "sync" ? (
                        <SyncPanel session={runningSession} onChanged={reloadAll} notify={push} />
                      ) : null}
                      {activeTab === "policy" ? <PolicyPanel notify={push} /> : null}
                      {activeTab === "info" ? (
                        // Thông tin container chỉ đọc — reuse nguyên vẹn từ trang Quản lý cũ.
                        <SandboxDetail sandboxId={selectedId} detail={detail} loading={detailLoading} />
                      ) : null}
                    </div>
                  </>
                )}
              </Card>
            </>
          ) : (
            <Card title="Thao tác sandbox">
              <EmptyState title="Chưa chọn phiên">
                Chọn một phiên ở cột trái để xem chi tiết và thao tác.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>

      {/* Modal Bật sandbox: TTL phút + CPU + RAM (port từ bảng Quản lý cũ) */}
      <StartModal
        open={modalOpen}
        session={startTarget}
        onClose={() => {
          setStartTarget(null);
          setModalOpen(false);
        }}
        onStarted={(result: StartResult) => {
          setStartTarget(null);
          setModalOpen(false);
          push(`Đã bật ${result.sandbox_id} · nạp ${result.materialized_files ?? 0} file`);
          // Effect theo notReadySessionId sẽ tự chuyển chọn khi overview mới về;
          // chọn luôn để phản hồi tức thì.
          setNotReadySessionId(null);
          setSelectedId(result.sandbox_id);
          reloadAll();
        }}
        notify={push}
      />

      {/* Modal Gia hạn: hỏi số phút */}
      <RenewModal
        open={modalOpen}
        session={renewTarget}
        onClose={() => {
          setRenewTarget(null);
          setModalOpen(false);
        }}
        onDone={() => {
          setRenewTarget(null);
          setModalOpen(false);
          push("Đã gia hạn phiên");
          reloadAll();
        }}
        notify={push}
      />

      {/* Xác nhận dừng sandbox: "plain" = dừng & xóa; "force" = bỏ thay đổi (mất vĩnh viễn) */}
      <ConfirmDialog
        open={confirmStop !== null}
        title={confirmStop === "force" ? "Dừng & bỏ thay đổi" : "Dừng & xóa sandbox"}
        message={
          confirmStop === "force"
            ? "Dừng và BỎ các thay đổi chưa nhận về kho trong sandbox? Các thay đổi chưa nhận về sẽ MẤT VĨNH VIỄN — không thể khôi phục. Nếu muốn giữ, hãy bấm “Hủy” rồi nhận về kho ở tab Đồng bộ."
            : `Dừng phiên và XÓA sandbox ${session?.sandbox_id ?? ""} cùng volume của nó? File trong kho VFS không mất, nhưng mọi thay đổi chỉ tồn tại trong sandbox sẽ không nhận về được nữa.`
        }
        confirmLabel={confirmStop === "force" ? "Dừng & bỏ thay đổi" : "Dừng & xóa"}
        danger
        busy={busyAction}
        onConfirm={() => {
          const force = confirmStop === "force";
          setConfirmStop(null);
          void runLifecycle("stop", force);
        }}
        onClose={() => setConfirmStop(null)}
      />

      <ToastStack toasts={toasts} />
    </div>
  );
}
