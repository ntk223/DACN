/**
 * mcpTools.ts — metadata 14 tool MCP, port nguyên từ trang admin cũ
 * (src/sandbox_kit_clone/gateway/admin.html, khối "Metadata 14 tool MCP").
 * fields: type text|number|bool|textarea|select|json; session=true → giá trị
 * lấy từ khung chọn phiên (readonly), không cho gõ trực tiếp.
 */

export type ToolFieldType = "text" | "number" | "bool" | "textarea" | "select" | "json";

export interface ToolField {
  key: string;
  label: string;
  type: ToolFieldType;
  /** Giá trị mặc định điền sẵn (nếu có). */
  def?: string | number | boolean;
  /** Danh sách lựa chọn cho type="select". */
  options?: string[];
  required?: boolean;
  /** true → lấy session_id từ khung chọn phiên, readonly. */
  session?: boolean;
  /** Hint nhỏ dưới control. */
  hint?: string;
}

export interface McpTool {
  name: string;
  group: string;
  desc: string;
  fields: ToolField[];
}

/** Trường session_id chung cho mọi tool cần phiên. */
export const SESSION_FIELD: ToolField = {
  key: "session_id",
  label: "session_id",
  type: "text",
  session: true,
  required: true,
};

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "workspace_create",
    group: "Workspace",
    desc: "Tạo workspace + phiên làm việc mới (sinh mã tự động)",
    fields: [
      { key: "name", label: "name", type: "text", def: "", required: false },
      {
        key: "conflict_policy",
        label: "conflict_policy",
        type: "select",
        options: ["sandbox_wins", "error"],
        def: "sandbox_wins",
        required: false,
      },
    ],
  },
  {
    name: "sandbox_start",
    group: "Sandbox",
    desc: "Chạy sandbox cho phiên (STANDBY → RUNNING)",
    fields: [
      SESSION_FIELD,
      { key: "ttl_seconds", label: "ttl_seconds", type: "number", def: 3600, required: false },
      { key: "cpu", label: "cpu (tùy chọn)", type: "number", required: false },
      { key: "memory", label: "memory (tùy chọn)", type: "number", required: false },
    ],
  },
  { name: "sandbox_stop", group: "Sandbox", desc: "Hủy sandbox của phiên (→ STANDBY)", fields: [SESSION_FIELD] },
  { name: "sandbox_pause", group: "Sandbox", desc: "Tạm dừng sandbox đang RUNNING (→ PAUSED)", fields: [SESSION_FIELD] },
  { name: "sandbox_resume", group: "Sandbox", desc: "Tiếp tục sandbox đang PAUSED (→ RUNNING)", fields: [SESSION_FIELD] },
  {
    name: "sandbox_renew",
    group: "Sandbox",
    desc: "Gia hạn thời hạn sống của sandbox",
    fields: [SESSION_FIELD, { key: "ttl_seconds", label: "ttl_seconds", type: "number", def: 3600, required: true }],
  },
  { name: "sandbox_status", group: "Sandbox", desc: "Xem trạng thái phiên + sandbox", fields: [SESSION_FIELD] },
  {
    name: "file_write",
    group: "Files",
    desc: "Ghi file (≤ ~3MB — quá hạn dùng tab Tải lên bên dưới)",
    fields: [
      SESSION_FIELD,
      { key: "path", label: "path", type: "text", def: "docs/ghi.txt", required: true },
      { key: "content", label: "content", type: "textarea", def: "Xin chào từ admin UI\n", required: true },
    ],
  },
  {
    name: "file_read",
    group: "Files",
    desc: "Đọc file: text/base64, hoặc download_url nếu file lớn",
    fields: [SESSION_FIELD, { key: "path", label: "path", type: "text", def: "", required: true }],
  },
  {
    name: "file_edit",
    group: "Files",
    desc: "Thay old_text → new_text (khớp chính xác rồi khớp mờ)",
    fields: [
      SESSION_FIELD,
      { key: "path", label: "path", type: "text", def: "", required: true },
      { key: "old_text", label: "old_text", type: "textarea", def: "", required: true },
      { key: "new_text", label: "new_text", type: "textarea", def: "", required: true },
    ],
  },
  {
    name: "file_delete",
    group: "Files",
    desc: "Xóa file khỏi kho (còn tombstone)",
    fields: [SESSION_FIELD, { key: "path", label: "path", type: "text", def: "", required: true }],
  },
  { name: "file_list", group: "Files", desc: "Liệt kê toàn bộ file trong kho", fields: [SESSION_FIELD] },
  {
    name: "command_run",
    group: "Lệnh",
    desc: "Chạy lệnh shell trong sandbox (phiên phải RUNNING; output gửi dần qua log notification)",
    fields: [
      SESSION_FIELD,
      { key: "command", label: "command", type: "text", def: "ls -la", required: true },
      { key: "cwd", label: "cwd (trong /workspace, tùy chọn)", type: "text", def: "", required: false },
      { key: "timeout_seconds", label: "timeout_seconds (0 = 120)", type: "number", def: 0, required: false },
    ],
  },
  { name: "sync_status", group: "Sync", desc: "Trạng thái đồng bộ kho ↔ sandbox", fields: [SESSION_FIELD] },
];

/** Nhóm tool theo thứ tự xuất hiện — dùng cho sidebar Console. */
export function groupMcpTools(tools: readonly McpTool[]): Array<{ name: string; tools: McpTool[] }> {
  const groups: Array<{ name: string; tools: McpTool[] }> = [];
  for (const tool of tools) {
    let group = groups.find((g) => g.name === tool.group);
    if (!group) {
      group = { name: tool.group, tools: [] };
      groups.push(group);
    }
    group.tools.push(tool);
  }
  return groups;
}
