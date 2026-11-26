/**
 * ExecConsole.tsx — chạy lệnh trong sandbox qua stream NDJSON.
 * Enter chạy, ↑/↓ duyệt lịch sử (localStorage), Dừng hủy bằng AbortController.
 * Chỉ phiên RUNNING mới chạy được — trạng thái khác khóa bàn phím.
 * UX: terminal nền tối chuẩn, tự cuộn theo output (giữ vị trí khi đang đọc),
 * nút nhảy xuống cuối, chip lệnh mẫu.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { IconPlay, IconStop } from "@/components/icons";
import type { ToastKind } from "@/components/Toast";
import { execStream } from "./sandboxApi";
import type { ExecEvent } from "./types";

type LineKind = "cmd" | "out" | "err" | "meta" | "ok" | "warn" | "result-ok" | "result-err";

interface TermLine {
  id: number;
  kind: LineKind;
  text: string;
}

const HISTORY_KEY = "sandbox.kit.execHistory";
const HISTORY_MAX = 100;

/** Lệnh mẫu bấm chạy ngay (giữ parity với trang cũ). */
const PRESETS: ReadonlyArray<string> = [
  "ls -la",
  "echo x > out.txt",
  "find . -type f | head -50",
  "python --version && git --version",
  "cat README.md",
  "for i in 1 2 3 4 5; do echo bước $i; sleep 1; done",
  "echo lỗi >&2; exit 2",
];

function loadHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

interface ExecConsoleProps {
  /** Phiên RUNNING đang chọn — null khi sandbox mồ côi / phiên không chạy. */
  sessionId: string | null;
  running: boolean;
  /** Báo trang tạm dừng auto-refresh trong lúc lệnh đang chạy. */
  onBusyChange: (busy: boolean) => void;
  notify: (message: string, kind?: ToastKind) => void;
}

/** Xử lý từng event NDJSON → vẽ ra terminal. */
function handleEvent(
  event: ExecEvent,
  append: (kind: LineKind, text: string) => void,
  setStatus: (text: string) => void,
): void {
  if (event.type === "output") {
    append(event.stream === "stderr" ? "err" : "out", event.text);
    return;
  }
  if (event.type === "prepared") {
    const sync = event.sync;
    if (sync?.skipped) {
      append("ok", `[đồng bộ: không có thay đổi mới · rev ${sync.revision ?? "?"}]\n`);
    } else if (sync) {
      append(
        "ok",
        `[đồng bộ: đẩy ${sync.put ?? 0} file, xóa ${sync.deleted ?? 0} · rev ${sync.revision ?? "?"}]\n`,
      );
    }
    for (const warning of event.policy?.warnings ?? []) {
      append("warn", `⚠ ${warning}\n`);
    }
    return;
  }
  if (event.type === "result") {
    const parts = [`exit ${event.exit_code}`, `${event.duration_ms} ms`];
    if (event.timed_out) parts.push("HẾT GIỜ — đã kill");
    if (event.truncated) parts.push("output bị cắt");
    if (event.error_detail) parts.push(event.error_detail);
    // Dòng kết quả: đường kẻ trên + xanh lá (exit 0) / đỏ (exit khác).
    append(event.exit_code === 0 && !event.timed_out ? "result-ok" : "result-err", `\n[${parts.join(" · ")}]\n`);
    setStatus(`exit ${event.exit_code} · ${event.duration_ms} ms`);
    return;
  }
  if (event.type === "error") {
    append("err", `\n[${event.error.code}] ${event.error.message}\n`);
    setStatus("lỗi");
  }
}

export function ExecConsole({ sessionId, running, onBusyChange, notify }: ExecConsoleProps) {
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState("");
  const [lines, setLines] = useState<TermLine[]>([]);
  const [status, setStatus] = useState("—");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  // True khi người dùng đã cuộn lên — hiện nút "xuống cuối".
  const [showJump, setShowJump] = useState(false);
  const historyIdx = useRef(-1);
  const lineId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const termRef = useRef<HTMLPreElement | null>(null);
  const atBottom = useRef(true);

  // Hủy stream khi unmount — không để fetch treo sau khi rời trang.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Cuộn xuống cuối khi có dòng mới — CHỈ khi người dùng đang ở cuối
  // (đang cuộn lên đọc output cũ thì giữ nguyên vị trí).
  useEffect(() => {
    const node = termRef.current;
    if (node && atBottom.current) {
      node.scrollTop = node.scrollHeight;
      setShowJump(false);
    }
  }, [lines]);

  const append = (kind: LineKind, text: string) => {
    lineId.current += 1;
    setLines((prev) => [...prev, { id: lineId.current, kind, text }]);
  };

  const saveHistory = (list: string[]) => {
    setHistory(list);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)));
    } catch {
      /* localStorage đầy / bị chặn — bỏ qua */
    }
  };

  /** Đường chạy chính: nhận lệnh trực tiếp (từ input hoặc preset). */
  const execute = async (cmd: string) => {
    if (!cmd || busy) return;
    if (!sessionId || !running) {
      notify("Sandbox không còn RUNNING — không chạy được lệnh", "error");
      return;
    }

    // Lưu lịch sử (tránh trùng lệnh cuối) và đặt lại vị trí duyệt.
    if (history[history.length - 1] !== cmd) {
      saveHistory([...history, cmd]);
    }
    historyIdx.current = -1;

    append("cmd", `$ ${cmd}`);
    setStatus("đang chạy…");
    setBusy(true);
    onBusyChange(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const timeout = Number.parseInt(timeoutSeconds, 10);
      for await (const event of execStream(
        sessionId,
        {
          command: cmd,
          cwd: cwd.trim(),
          timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
        },
        controller.signal,
      )) {
        handleEvent(event, append, setStatus);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        append("warn", "\n[đã hủy bởi người dùng]\n");
        setStatus("đã hủy");
      } else {
        const message = error instanceof Error ? error.message : "lỗi không xác định";
        append("err", `\n[lỗi] ${message}\n`);
        setStatus("lỗi");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      onBusyChange(false);
    }
  };

  const stopCommand = () => {
    abortRef.current?.abort();
  };

  /** Nút "xuống cuối": cuộn terminal về dòng mới nhất. */
  const jumpToBottom = () => {
    const node = termRef.current;
    if (!node) return;
    atBottom.current = true;
    node.scrollTop = node.scrollHeight;
    setShowJump(false);
  };

  const onTermScroll = (event: React.UIEvent<HTMLPreElement>) => {
    const node = event.currentTarget;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 30;
    atBottom.current = nearBottom;
    setShowJump(!nearBottom);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void execute(command.trim());
    } else if (event.key === "ArrowUp" && history.length > 0) {
      // ↑: lùi về trước trong lịch sử; mốc -1 nghĩa là chưa duyệt (bắt đầu từ cuối).
      event.preventDefault();
      const next = historyIdx.current < 0 ? history.length - 1 : Math.max(0, historyIdx.current - 1);
      historyIdx.current = next;
      setCommand(history[next] ?? "");
    } else if (event.key === "ArrowDown" && history.length > 0) {
      event.preventDefault();
      if (historyIdx.current < 0) return;
      const next = historyIdx.current + 1;
      if (next >= history.length) {
        // Vượt quá cuối lịch sử → xóa trắng như shell.
        historyIdx.current = -1;
        setCommand("");
      } else {
        historyIdx.current = next;
        setCommand(history[next] ?? "");
      }
    }
  };

  return (
    <Card title="Chạy lệnh" actions={<span className="sbx-meta">{status}</span>}>
      {!running ? (
        <div className="sbx-meta" style={{ marginBottom: 8 }}>
          🔒 Chỉ sandbox đang RUNNING mới chạy được lệnh — bật hoặc tiếp tục phiên trước.
        </div>
      ) : null}
      {/* Hàng nhập lệnh: input + Chạy (primary) + Dừng (đỏ, khi đang chạy) + Xóa màn hình */}
      <div className="sbx-toolbar">
        <input
          className="input sbx-cmdline"
          type="text"
          aria-label="Lệnh shell"
          placeholder="Nhập lệnh, Enter để chạy…"
          autoComplete="off"
          spellCheck={false}
          disabled={!running || !sessionId}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          disabled={!running || !sessionId || busy}
          title="Chạy lệnh (Enter)"
          onClick={() => void execute(command.trim())}
        >
          <IconPlay size={16} /> Chạy
        </Button>
        {busy ? (
          <Button variant="danger" title="Hủy lệnh đang chạy (AbortController)" onClick={stopCommand}>
            <IconStop size={16} /> Dừng
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setLines([])} disabled={busy} title="Xóa toàn bộ output terminal">
          Xóa màn hình
        </Button>
      </div>
      {/* cwd + timeout — tùy chọn, để hàng riêng cho gọn hàng nhập chính */}
      <div className="sbx-toolbar" style={{ marginTop: 8 }}>
        <Field label="cwd (trong /workspace)">
          <input
            className="input"
            type="text"
            style={{ width: 160 }}
            placeholder="."
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
          />
        </Field>
        <Field label="timeout (giây)">
          <input
            className="input"
            type="number"
            style={{ width: 110 }}
            placeholder="120"
            min={1}
            max={600}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
          />
        </Field>
      </div>
      {/* Chip lệnh mẫu — bấm chạy ngay, title hiện lệnh đầy đủ */}
      <div className="sbx-chips" style={{ marginTop: 8 }}>
        <span className="sbx-meta">Lệnh mẫu:</span>
        {PRESETS.map((preset) => {
          const label = preset.length > 26 ? `${preset.slice(0, 24)}…` : preset;
          return (
            <Button
              key={preset}
              size="sm"
              variant="ghost"
              className="sbx-chip"
              title={preset}
              disabled={!running || busy}
              onClick={() => {
                setCommand(preset);
                void execute(preset);
              }}
            >
              {label}
            </Button>
          );
        })}
      </div>
      {/* Terminal — nền tối chuẩn, tự cuộn, nút xuống cuối khi đang đọc lên trên */}
      <div className="sbx-term-wrap">
        <pre ref={termRef} className="sbx-term" onScroll={onTermScroll}>
          {lines.length === 0 ? (
            <span className="ln-meta">Kết quả hiện dần ở đây trong lúc lệnh chạy.</span>
          ) : null}
          {lines.map((line) => (
            <span key={line.id} className={`ln-${line.kind}`}>
              {line.text}
            </span>
          ))}
        </pre>
        {showJump ? (
          <button type="button" className="sbx-term-jump" title="Nhảy xuống dòng mới nhất" onClick={jumpToBottom}>
            ↓ cuối trang
          </button>
        ) : null}
      </div>
    </Card>
  );
}
