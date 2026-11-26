/**
 * ConsoleTab.tsx — Console MCP: port tính năng chính của trang admin cũ.
 * - Khung chọn workspace/session 2 bước (mọi tool call lấy session_id từ đây).
 * - Sidebar 14 tool chia nhóm + ô tìm kiếm (metadata port từ admin.html).
 * - Form sinh động theo metadata, gọi POST /mcp/ (JSON-RPC tools/call),
 *   parse được JSON thuần lẫn SSE; kết quả hiển thị trong khung pre mono
 *   có nút Copy và Xóa kết quả.
 */

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { StateBadge } from "@/components/StateBadge";
import { IconErrorCircle, IconSearch, IconTrash, IconWarn } from "@/components/icons";
import { get } from "@/lib/api";

import { callMcpTool, isObject, safeJsonStringify } from "./mcp";
import type { McpCallOutcome } from "./mcp";
import { MCP_TOOLS, groupMcpTools } from "./mcpTools";
import type { McpTool, ToolField } from "./mcpTools";
import { OvLoading } from "./states";
import type { SessionRow, WorkspaceDetailResponse } from "./types";
import { useWorkspaces } from "./useWorkspaces";

const TOOL_GROUPS = groupMcpTools(MCP_TOOLS);
const FIRST_TOOL: McpTool = MCP_TOOLS[0]!; // metadata có sẵn tool đầu tiên

interface Outcome {
  tool: string;
  data: unknown;
  isError: boolean;
  ms: number;
}

export function ConsoleTab() {
  const { workspaces, loading, error, reload } = useWorkspaces();

  const [workspaceId, setWorkspaceId] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  const [selectedTool, setSelectedTool] = useState<McpTool>(FIRST_TOOL);
  const [toolQuery, setToolQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sending, setSending] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  // Tự chọn workspace đầu tiên khi danh sách vừa nạp.
  useEffect(() => {
    if (workspaceId === "" && workspaces.length > 0) {
      setWorkspaceId(workspaces[0]!.id);
    }
  }, [workspaces, workspaceId]);

  // Đổi workspace → nạp sessions của workspace đó (GET /admin/api/workspaces/{id}).
  useEffect(() => {
    if (workspaceId === "") {
      setSessions([]);
      setSessionId("");
      return;
    }
    const controller = new AbortController();
    setSessionsLoading(true);
    setSessionsError(null);
    get<WorkspaceDetailResponse>(`/admin/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      signal: controller.signal,
    })
      .then((detail) => {
        setSessions(detail.sessions ?? []);
        // Ưu tiên phiên đã chọn nếu vẫn còn, không thì chọn phiên đầu tiên.
        const first = detail.sessions[0]?.session_id ?? "";
        setSessionId((prev) =>
          detail.sessions.some((s) => s.session_id === prev) ? prev : first,
        );
        setSessionsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSessionsError(err instanceof Error ? err.message : String(err));
        setSessions([]);
        setSessionsLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId]);

  // Lọc tool theo tên gõ trong ô tìm kiếm (không phân biệt hoa thường).
  const filteredGroups = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (query === "") return TOOL_GROUPS;
    return TOOL_GROUPS.map((group) => ({
      name: group.name,
      tools: group.tools.filter((tool) => tool.name.toLowerCase().includes(query)),
    })).filter((group) => group.tools.length > 0);
  }, [toolQuery]);
  const filteredCount = filteredGroups.reduce((sum, group) => sum + group.tools.length, 0);

  // Tool nào cần session_id → cảnh báo vàng ngay khi thiếu phiên (không chờ bấm Gửi).
  const toolNeedsSession = selectedTool.fields.some((field) => field.session);
  const missingSession = toolNeedsSession && !sessionsLoading && sessionsError === null && sessionId === "";

  /** Gửi tool call; workspace_create thành công → cập nhật khung chọn luôn. */
  async function handleSend(tool: McpTool, args: Record<string, unknown>) {
    setSending(true);
    setPanelError(null);
    setOutcome(null);
    try {
      const out: McpCallOutcome = await callMcpTool(tool.name, args);
      setOutcome({ tool: tool.name, data: out.data, isError: out.isError, ms: out.ms });
      // Tạo workspace mới → tự điền workspace/session vào khung chọn.
      if (tool.name === "workspace_create" && !out.isError && isObject(out.data)) {
        const newWorkspace = typeof out.data.workspace_id === "string" ? out.data.workspace_id : "";
        const newSession = typeof out.data.session_id === "string" ? out.data.session_id : "";
        if (newWorkspace !== "") {
          reload(); // nạp lại danh sách workspace
          setWorkspaceId(newWorkspace);
          if (newSession !== "") setSessionId(newSession);
        }
      }
    } catch (err: unknown) {
      setPanelError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <Card title="Console MCP">
        <OvLoading
          title="Đang tải Console MCP…"
          description="Đang lấy danh sách workspace để khung chọn phiên."
        />
      </Card>
    );
  }

  if (error !== null) {
    return (
      <Card title="Console MCP">
        <div className="ov-alert" role="alert">
          <IconErrorCircle />
          <div className="ov-alert-body">
            <strong>Không tải được danh sách workspace</strong>
            <span>{error}</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="ov-console">
      {/* ---- Cột trái: khung chọn phiên 2 bước + danh sách tool ---- */}
      <div className="ov-console-col">
        <Card title="Phiên làm việc">
          <div className="ov-form">
            <Field label="Bước 1 · Workspace" hint="Chọn workspace cần thao tác.">
              <select
                className="select"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                aria-label="Workspace"
              >
                {workspaces.length === 0 ? <option value="">(chưa có workspace)</option> : null}
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name ? `${ws.name} — ${ws.id}` : ws.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Bước 2 · Session"
              hint={
                sessionsLoading
                  ? "Đang nạp phiên…"
                  : "Chọn workspace mới sẽ tự chọn phiên đầu tiên. Tạo workspace bằng tool workspace_create cũng tự điền."
              }
            >
              <select
                className="select mono"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                disabled={workspaces.length === 0 || sessions.length === 0}
                aria-label="Session"
              >
                {sessions.length === 0 ? <option value="">(không có phiên)</option> : null}
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.session_id} · {s.state}
                  </option>
                ))}
              </select>
            </Field>
            {sessionsError !== null ? (
              <div className="ov-alert" role="alert">
                <IconErrorCircle />
                <div className="ov-alert-body">
                  <strong>Không nạp được phiên</strong>
                  <span>{sessionsError}</span>
                </div>
              </div>
            ) : null}
            {sessionsLoading ? (
              <Spinner label="Đang nạp phiên…" />
            ) : sessionId === "" ? (
              <div className="ov-warning" role="status">
                <IconWarn />
                <div className="ov-alert-body">
                  <span>
                    Workspace này chưa có phiên — các tool cần session sẽ không gửi được. Hãy tạo phiên bằng tool{" "}
                    <code>workspace_create</code>.
                  </span>
                </div>
              </div>
            ) : (
              <SessionBadge sessionId={sessionId} sessions={sessions} />
            )}
          </div>
        </Card>

        <Card title={`Tools MCP (${filteredCount}/${MCP_TOOLS.length})`}>
          <div className="ov-tool-search">
            <IconSearch />
            <input
              className="input"
              type="search"
              placeholder="Tìm tool theo tên…"
              aria-label="Tìm tool MCP theo tên"
              value={toolQuery}
              onChange={(e) => setToolQuery(e.target.value)}
            />
          </div>
          {filteredGroups.length === 0 ? (
            <div className="ov-state">
              <div className="ov-state-title">Không có tool nào khớp</div>
              <div className="ov-state-desc">Thử từ khóa khác, ví dụ “file” hoặc “sandbox”.</div>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.name} className="ov-tool-group">
                <div className="ov-tool-group-label">{group.name}</div>
                {group.tools.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    className={tool.name === selectedTool.name ? "ov-tool-btn active" : "ov-tool-btn"}
                    title={tool.desc}
                    aria-pressed={tool.name === selectedTool.name}
                    onClick={() => setSelectedTool(tool)}
                  >
                    {tool.name}
                  </button>
                ))}
              </div>
            ))
          )}
        </Card>
      </div>

      {/* ---- Cột phải: form + kết quả ---- */}
      <div className="ov-console-col">
        <Card title="Gọi tool MCP">
          <ToolForm
            key={selectedTool.name}
            tool={selectedTool}
            sessionId={sessionId}
            sending={sending}
            missingSession={missingSession}
            onSubmit={(args) => void handleSend(selectedTool, args)}
          />
        </Card>

        {panelError !== null ? (
          <Card>
            <div className="ov-alert" role="alert">
              <IconErrorCircle />
              <div className="ov-alert-body">
                <strong>Lỗi gọi tool</strong>
                <span>{panelError}</span>
              </div>
            </div>
          </Card>
        ) : null}

        {outcome !== null ? <ResultPanel outcome={outcome} onClear={() => setOutcome(null)} /> : null}
      </div>
    </div>
  );
}

/** Badge trạng thái phiên đang chọn — dùng StateBadge dùng chung
 * (nhãn tiếng Việt + tone + tooltip; state lạ hiển thị mã gốc nền xám). */
function SessionBadge({ sessionId, sessions }: { sessionId: string; sessions: SessionRow[] }) {
  if (sessionId === "") {
    return <Badge tone="gray">chưa chọn phiên</Badge>;
  }
  const current = sessions.find((s) => s.session_id === sessionId);
  return <StateBadge state={current?.state ?? "—"} />;
}

/** Form sinh động theo metadata — key theo tool.name để đổi tool là reset form. */
function ToolForm({
  tool,
  sessionId,
  sending,
  missingSession,
  onSubmit,
}: {
  tool: McpTool;
  sessionId: string;
  sending: boolean;
  missingSession: boolean;
  onSubmit: (args: Record<string, unknown>) => void;
}) {
  // Giá trị form: bool giữ boolean, còn lại giữ chuỗi (number/json parse lúc gửi).
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const initial: Record<string, string | boolean> = {};
    for (const field of tool.fields) {
      if (field.session) continue; // session_id lấy từ khung chọn
      // bool giữ boolean; text/number/select/textarea/json đều giữ chuỗi (parse lúc gửi).
      initial[field.key] =
        field.def === undefined ? "" : typeof field.def === "boolean" ? field.def : String(field.def);
    }
    return initial;
  });
  const [formError, setFormError] = useState<string | null>(null);

  const setValue = (key: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  function handleSubmit() {
    setFormError(null);
    const args: Record<string, unknown> = {};
    for (const field of tool.fields) {
      if (field.session) {
        // session_id LUÔN lấy từ khung chọn phiên — trống thì chặn.
        if (sessionId.trim() === "") {
          setFormError(
            "Chưa chọn session — hãy chọn workspace/phiên trong khung “Phiên làm việc” ở bên trái (hoặc tạo workspace bằng tool workspace_create).",
          );
          return;
        }
        args[field.key] = sessionId.trim();
        continue;
      }
      const raw = values[field.key];
      if (field.type === "bool") {
        args[field.key] = raw === true;
        continue;
      }
      const text = typeof raw === "string" ? raw : "";
      if (field.type === "number") {
        if (text.trim() === "") continue; // bỏ trống → server dùng default
        const n = Number(text);
        if (Number.isNaN(n)) {
          setFormError(`Trường “${field.label}” phải là số.`);
          return;
        }
        args[field.key] = n;
        continue;
      }
      if (field.type === "json") {
        if (text.trim() === "") continue;
        try {
          args[field.key] = JSON.parse(text) as unknown;
        } catch {
          setFormError(`Trường “${field.label}” không phải JSON hợp lệ.`);
          return;
        }
        continue;
      }
      args[field.key] = text; // text/textarea/select — gửi cả chuỗi rỗng (đúng contract default)
    }
    onSubmit(args);
  }

  return (
    <form
      className="ov-form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: "var(--font-size-lg)" }}>{tool.name}</div>
        <div className="ov-form-desc">{tool.desc}</div>
      </div>

      {tool.fields.map((field) => (
        <ToolFieldInput
          key={field.key}
          field={field}
          value={field.session ? sessionId : (values[field.key] ?? "")}
          onChange={(value) => setValue(field.key, value)}
        />
      ))}

      {missingSession ? (
        <div className="ov-warning" role="status">
          <IconWarn />
          <div className="ov-alert-body">
            <span>
              Chưa chọn session — hãy chọn workspace/phiên trong khung “Phiên làm việc” (hoặc tạo workspace bằng tool{" "}
              <code>workspace_create</code>).
            </span>
          </div>
        </div>
      ) : null}

      {formError !== null ? (
        <div className="ov-alert" role="alert">
          <IconErrorCircle />
          <div className="ov-alert-body">
            <span>{formError}</span>
          </div>
        </div>
      ) : null}

      <div className="ov-form-footer">
        <span className="ov-form-footer-info">POST /mcp/ · tools/call → {tool.name}</span>
        <Button variant="primary" type="submit" loading={sending}>
          Gửi
        </Button>
      </div>
    </form>
  );
}

/** Render 1 field theo type: text/number/textarea/select/bool/json/session. */
function ToolFieldInput({
  field,
  value,
  onChange,
}: {
  field: ToolField;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.session) {
    return (
      <Field
        label={`${field.label}${field.required ? " *" : ""}`}
        hint="Lấy tự động từ khung chọn phiên bên trái — không gõ trực tiếp."
      >
        <input className="input mono" type="text" value={typeof value === "string" ? value : ""} readOnly />
      </Field>
    );
  }
  if (field.type === "bool") {
    return (
      <Field label={field.label} hint={field.hint}>
        {/* Checkbox 18px trong hàng ≥38px — vùng bấm rộng (Field đã là <label>,
            bấm vào cả dòng nhãn đều bật/tắt được). */}
        <div className="ov-check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      </Field>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={`${field.label}${field.required ? " *" : ""}`} hint={field.hint}>
        <select
          className="select"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (field.type === "textarea" || field.type === "json") {
    return (
      <Field
        label={`${field.label}${field.required ? " *" : ""}`}
        hint={field.type === "json" ? "Nhập JSON object hợp lệ (vd: {\"key\": 1})." : field.hint}
      >
        <textarea
          className="textarea"
          rows={field.type === "json" ? 6 : 4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }
  return (
    <Field label={`${field.label}${field.required ? " *" : ""}`} hint={field.hint}>
      <input
        className="input"
        type={field.type === "number" ? "number" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Khung kết quả: pre mono + Copy + Xóa kết quả; lỗi → nền đỏ + icon. */
function ResultPanel({ outcome, onClear }: { outcome: Outcome; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => safeJsonStringify(outcome.data), [outcome.data]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard bị chặn (không https / quyền) — bỏ qua, người dùng vẫn chọn được text.
    }
  }

  return (
    <Card title="Kết quả">
      <div className="ov-result">
        <div className="ov-result-head">
          {outcome.isError ? <Badge tone="red">LỖI</Badge> : <Badge tone="green">OK</Badge>}
          <span className="ov-form-endpoint">{outcome.tool}</span>
          <span className="ov-form-desc">{outcome.ms} ms</span>
          <span className="ov-result-spacer" />
          <Button size="sm" onClick={() => void handleCopy()}>
            {copied ? "Đã copy ✓" : "Copy"}
          </Button>
          <Button size="sm" variant="ghost" className="btn-icon" title="Xóa kết quả" onClick={onClear}>
            <IconTrash />
          </Button>
        </div>
        {outcome.isError ? (
          <div className="ov-alert" role="alert">
            <IconErrorCircle />
            <div className="ov-alert-body">
              <span>Tool trả về lỗi — xem chi tiết JSON bên dưới.</span>
            </div>
          </div>
        ) : null}
        <pre className={outcome.isError ? "mono-pre is-error" : "mono-pre"}>{text}</pre>
      </div>
    </Card>
  );
}
