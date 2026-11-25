/**
 * SandboxOpsPage.tsx — trang THAO TÁC: nơi tập trung đầy đủ mọi thao tác.
 * Trái (~280px): danh sách phiên — sandbox hoạt động (RUNNING/PAUSED) và cả
 * phiên STANDBY (badge xám "chưa bật") để bật ngay từ đây.
 * Phải:
 *  - Phiên STANDBY → banner vàng "Phiên này chưa bật sandbox" + nút Bật
 *    (modal TTL/CPU/RAM có validation, gọi cùng API start như trang Quản lý cũ).
 *  - Phiên STARTING → banner "đang bật…".
 *  - Phiên có sandbox → thanh hành động ngay dưới tiêu đề sandbox_id:
 *    Tạm dừng / Tiếp tục / Gia hạn (modal hỏi phút) / Dừng & xóa (confirm),
 *    hiển thị theo trạng thái; banner PAUSED gộp vào thanh hành động.
 *    Dưới thanh là tabs Chạy lệnh / File / Log / Đồng bộ / Kiểm tra lệnh /
 *    Thông tin (giữ nguyên).
 * Nhận navRequest từ trang Quản lý: chọn đúng phiên được yêu cầu — kể cả
 * phiên chưa bật sandbox (hiện khối Bật ngay tại đây).
 * Tự làm mới 5 giây — tạm dừng khi lệnh exec đang chạy / người dùng đang gõ /
 * modal Bật·Gia hạn đang mở.
 */
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { Tabs } from "@/components/Tabs";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import type { SandboxOpsRequest } from "@/lib/nav";
import { ExecConsole } from "./ExecConsole";
import { FileBrowser } from "./FileBrowser";
import { LoadErrorBanner, LoadErrorCard, useSandboxData } from "./SandboxData";
import { LogsPanel } from "./LogsPanel";
import { PolicyPanel } from "./PolicyPanel";
import { SandboxDetail } from "./SandboxDetail";
import { providerTone, SyncBadge, ttlUrgency } from "./SandboxTable";
import { sandboxApi } from "./sandboxApi";
import { SyncPanel } from "./SyncPanel";
import { ToastStack, useToasts } from "./Toast";
import "./sandbox.css";
import type { ProviderCapabilities, SessionRow, StartResult } from "./types";
import { limitsLabel, remainLabel } from "./util";

type TabKey = "exec" | "files" | "logs" | "sync" | "policy" | "info";

type Notify = (message: string, kind?: "ok" | "err" | "warn") => void;

/** Badge trạng thái của item cột trái (dot + nhãn ngắn; STANDBY/STARTING xám). */
function ItemStateBadge({ state }: { state: SessionRow["state"] }) {
  const meta: Record<SessionRow["state"], { tone: "green" | "yellow" | "gray"; label: string }> = {
    RUNNING: { tone: "green", label: "Đang chạy" },
    PAUSED: { tone: "yellow", label: "Tạm dừng" },
    STARTING: { tone: "gray", label: "đang bật" },
    STANDBY: { tone: "gray", label: "chưa bật" },
  };
  const m = meta[state];
  return (
    <Badge tone={m.tone}>
      <span className={`sbx-dot${state === "RUNNING" ? " sbx-dot-live" : ""}`} aria-hidden="true" />
      {m.label}
    </Badge>
  );
}

export function SandboxOpsPage({ navRequest }: { navRequest?: SandboxOpsRequest }) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [execBusy, setExecBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const { toasts, push } = useToasts();

  const { overview, error, refreshing, selectedId, setSelectedId, detail, detailLoading, reloadAll, typingProps } =
    useSandboxData(!autoRefresh || execBusy || modalOpen);

  // ---- Điều hướng từ trang Quản lý (navRequest theo nonce) ----
  /** Phiên được yêu cầu mở — null khi không có yêu cầu hoặc đã xử lý xong. */
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
    overview?.sessions.filter(
      (s) => (s.state === "RUNNING" || s.state === "PAUSED") && s.sandbox_id,
    ) ?? [];

  // Xử lý yêu cầu điều hướng khi overview đã tải: chọn phiên — sandbox thì
  // chọn sandbox_id, STANDBY/STARTING thì chọn theo session_id (khối Bật/xem).
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
  /** session_id của phiên STANDBY/STARTING đang chọn ở cột trái. */
  const [notReadySessionId, setNotReadySessionId] = useState<string | null>(null);
  const notReadySession =
    overview?.sessions.find(
      (s) => s.session_id === notReadySessionId && (s.state === "STANDBY" || s.state === "STARTING"),
    ) ?? null;

  // Phiên đang chọn "chưa bật" vừa có sandbox (vừa bật xong) → chuyển sang
  // chọn sandbox như thường, bỏ trạng thái chưa-bật.
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

  const session: SessionRow | null =
    activeSessions.find((s) => s.sandbox_id === selectedId) ?? null;

  /** Phiên RUNNING — điều kiện để exec/sync chạy thật (PAUSED → khóa). */
  const runningSession = session !== null && session.state === "RUNNING" ? session : null;

  // ---- Thanh hành động phiên: pause/resume/stop/renew ----
  const [busyAction, setBusyAction] = useState(false);
  const [renewTarget, setRenewTarget] = useState<SessionRow | null>(null);
  const [startTarget, setStartTarget] = useState<SessionRow | null>(null);
  /** Thông báo khi stop bị gate chống mất dữ liệu chặn (lỗi conflict) — hiện cảnh báo inline. */
  const [stopConflict, setStopConflict] = useState<string | null>(null);

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
          ? force
            ? "Đã dừng (bỏ thay đổi) — sandbox và volume đã xóa"
            : "Đã dừng — sandbox và volume đã xóa"
          : `Phiên → ${action === "pause" ? "tạm dừng" : "chạy lại"}`,
      );
    } catch (err) {
      if (action === "stop" && err instanceof ApiError && err.code === "conflict") {
        setStopConflict(err.message);
      } else {
        push(err instanceof Error ? err.message : "Thao tác thất bại", "err");
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
    { key: "files", label: "File /workspace" as ReactNode },
    { key: "logs", label: "Log" as ReactNode },
    { key: "sync", label: "Đồng bộ" as ReactNode },
    { key: "policy", label: "Kiểm tra lệnh" as ReactNode },
    { key: "info", label: "Thông tin" as ReactNode },
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
                      <ItemStateBadge state={row.state} />
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
            <label
              className="sbx-meta"
              style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}
            >
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
          {notReadySession !== null && notReadySession.state === "STANDBY" ? (
            // Phiên chưa bật sandbox — bật ngay tại đây bằng modal TTL/CPU/RAM.
            <Card
              title={
                <span style={{ fontWeight: 600 }}>
                  {notReadySession.workspace_name ?? notReadySession.workspace_id}
                </span>
              }
              actions={
                <span className="sbx-meta sbx-mono">
                  ws {notReadySession.workspace_id} · phiên {notReadySession.session_id.slice(0, 12)}…
                </span>
              }
            >
              <div className="sbx-banner-warn" role="status" style={{ marginBottom: 12 }}>
                <span>
                  <b>Phiên này chưa bật sandbox</b> — bật để chạy lệnh, xem file và đồng bộ.
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setStartTarget(notReadySession);
                    setModalOpen(true);
                  }}
                >
                  Bật sandbox
                </Button>
              </div>
              <EmptyState title="Sandbox chưa khởi tạo">
                Bấm “Bật sandbox” phía trên, chọn TTL và tài nguyên rồi xác nhận.
              </EmptyState>
            </Card>
          ) : notReadySession !== null && notReadySession.state === "STARTING" ? (
            // Provider đang khởi tạo container — chỉ chờ.
            <Card title="Thao tác sandbox">
              <div className="sbx-banner-warn" role="status" style={{ marginBottom: 12 }}>
                <span>
                  <b>Đang bật sandbox…</b> — provider đang khởi tạo container, chờ vài giây rồi tải lại.
                </span>
              </div>
              <EmptyState title="Sandbox đang khởi tạo">
                Phiên sẽ tự chuyển sang “Đang chạy” sau khi container sẵn sàng.
              </EmptyState>
            </Card>
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
                    <ItemStateBadge state={session.state} />
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
                    onClick={() => {
                      if (
                        window.confirm(
                          `Dừng phiên và XÓA sandbox ${session.sandbox_id} cùng volume? (File trong kho VFS không mất.)`,
                        )
                      ) {
                        void runLifecycle("stop");
                      }
                    }}
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
                        onClick={() => {
                          if (
                            window.confirm(
                              "Dừng và BỎ các thay đổi chưa nhận về kho trong sandbox? Thay đổi chưa nhận sẽ MẤT vĩnh viễn.",
                            )
                          ) {
                            void runLifecycle("stop", true);
                          }
                        }}
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
        session={startTarget}
        onClose={() => {
          setStartTarget(null);
          setModalOpen(false);
        }}
        onDone={(result: StartResult) => {
          setStartTarget(null);
          setModalOpen(false);
          push(`Đã bật ${result.sandbox_id} · nạp ${result.materialized_files ?? 0} file`);
          // Effect theo notReadySessionId sẽ tự chuyển sang chọn sandbox khi
          // overview mới về; chọn luôn để phản hồi tức thì.
          setNotReadySessionId(null);
          setSelectedId(result.sandbox_id);
          reloadAll();
        }}
        notify={push}
      />

      {/* Modal Gia hạn: hỏi số phút */}
      <RenewModal
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

      <ToastStack toasts={toasts} />
    </div>
  );
}

interface StartModalProps {
  session: SessionRow | null;
  onClose: () => void;
  onDone: (result: StartResult) => void;
  notify: Notify;
}

/** Modal Bật sandbox — TTL/CPU/RAM + validation inline (port từ SandboxTable). */
function StartModal({ session, onClose, onDone, notify }: StartModalProps) {
  const [ttlMinutes, setTtlMinutes] = useState("60");
  const [cpu, setCpu] = useState("");
  const [memoryMb, setMemoryMb] = useState("");
  const [busy, setBusy] = useState(false);

  // Validation inline — chặn gửi khi giá trị không hợp lệ.
  const ttlNum = Number(ttlMinutes);
  const ttlInvalid = ttlMinutes.trim() === "" || !Number.isFinite(ttlNum) || ttlNum <= 0;
  const cpuNum = Number(cpu);
  const cpuInvalid = cpu.trim() !== "" && (!Number.isFinite(cpuNum) || cpuNum <= 0);
  const memNum = Number(memoryMb);
  const memInvalid = memoryMb.trim() !== "" && (!Number.isFinite(memNum) || memNum <= 0);
  const invalid = ttlInvalid || cpuInvalid || memInvalid;

  const submit = async () => {
    if (!session || invalid) return;
    const ttl = Math.max(1, Math.round(ttlNum * 60));
    setBusy(true);
    try {
      const result = await sandboxApi.start(session.session_id, {
        ttl_seconds: ttl,
        cpu: cpu.trim() !== "" && Number.isFinite(cpuNum) && cpuNum > 0 ? cpuNum : null,
        memory: memoryMb.trim() !== "" && Number.isFinite(memNum) && memNum > 0 ? memNum : null,
      });
      onDone(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Bật sandbox thất bại", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={session !== null}
      title={`Bật sandbox — ${session?.workspace_name ?? session?.workspace_id ?? ""}`}
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field
          label="TTL — thời gian sống (phút)"
          hint="Mặc định 60 phút. Hết hạn sandbox tự dừng sau khoảng này."
        >
          <input
            className={`input${ttlInvalid ? " input-invalid" : ""}`}
            type="number"
            min={1}
            aria-invalid={ttlInvalid}
            value={ttlMinutes}
            onChange={(event) => setTtlMinutes(event.target.value)}
          />
        </Field>
        {ttlInvalid ? (
          <span className="sbx-field-error" style={{ marginTop: -6 }}>TTL phải là số lớn hơn 0.</span>
        ) : null}
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="CPU (core)" hint="Mặc định: không giới hạn.">
            <input
              className={`input${cpuInvalid ? " input-invalid" : ""}`}
              type="number"
              step="0.5"
              min="0"
              placeholder="không giới hạn"
              aria-invalid={cpuInvalid}
              value={cpu}
              onChange={(event) => setCpu(event.target.value)}
            />
          </Field>
          <Field label="RAM (MB)" hint="Mặc định: không giới hạn.">
            <input
              className={`input${memInvalid ? " input-invalid" : ""}`}
              type="number"
              step="128"
              min="0"
              placeholder="không giới hạn"
              aria-invalid={memInvalid}
              value={memoryMb}
              onChange={(event) => setMemoryMb(event.target.value)}
            />
          </Field>
        </div>
        {cpuInvalid || memInvalid ? (
          <span className="sbx-field-error">CPU / RAM phải là số lớn hơn 0, hoặc bỏ trống.</span>
        ) : null}
        <div className="sbx-toolbar">
          <span className="sbx-meta">
            Tổng tài nguyên: {limitsLabel(Number(cpu) || null, Number(memoryMb) || null)}
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={() => void submit()}>
            Bật sandbox
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface RenewModalProps {
  session: SessionRow | null;
  onClose: () => void;
  onDone: () => void;
  notify: Notify;
}

/** Modal Gia hạn — hỏi số phút cộng vào thời hạn hiện tại (port từ SandboxTable). */
function RenewModal({ session, onClose, onDone, notify }: RenewModalProps) {
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);

  const num = Number(minutes);
  const invalid = minutes.trim() === "" || !Number.isFinite(num) || num <= 0;

  const submit = async () => {
    if (!session || invalid) return;
    const ttl = Math.max(1, Math.round(num * 60));
    setBusy(true);
    try {
      await sandboxApi.renew(session.session_id, ttl);
      onDone();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gia hạn thất bại", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={session !== null}
      title={`Gia hạn — ${session?.workspace_name ?? session?.workspace_id ?? ""}`}
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field
          label="Số phút gia hạn thêm"
          hint="Mặc định 60 phút — cộng vào thời hạn hiện tại của phiên."
        >
          <input
            className={`input${invalid ? " input-invalid" : ""}`}
            type="number"
            min={1}
            aria-invalid={invalid}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </Field>
        {invalid ? (
          <span className="sbx-field-error" style={{ marginTop: -6 }}>Số phút phải là số lớn hơn 0.</span>
        ) : null}
        <div className="sbx-toolbar">
          <span className="sbx-meta">Hiện tại: {remainLabel(session?.expires_at)}</span>
          <span className="spacer" />
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={() => void submit()}>
            Gia hạn
          </Button>
        </div>
      </div>
    </Modal>
  );
}
