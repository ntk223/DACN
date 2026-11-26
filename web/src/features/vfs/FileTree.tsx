import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { IconFile, IconFolder } from "@/components/icons";
import { formatBytes } from "@/lib/format";
import type { VfsFileRow } from "./types";

interface FileTreeProps {
  files: VfsFileRow[];
  /** Danh sách đã lọc theo ô tìm kiếm (truyền từ ngoài để đồng bộ trạng thái rỗng). */
  filtered: VfsFileRow[];
  activePath: string | null;
  onOpen: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: VfsFileRow[];
}

/** Dựng cây thư mục từ danh sách path phẳng (giữ logic buildTree của trang cũ). */
function buildTree(files: VfsFileRow[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] ?? "";
      const key = parts.slice(0, i + 1).join("/");
      let child = node.dirs.get(part);
      if (child === undefined) {
        child = { name: part, path: key, dirs: new Map(), files: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

/** Badge/size xếp gọn bên phải của mỗi dòng file. */
function FileBadges({ file }: { file: VfsFileRow }) {
  return (
    <span className="vfs-node-badges">
      {file.storage_class === "blob" ? (
        <Badge tone="default" title="File rời (blob sidecar)">
          blob
        </Badge>
      ) : null}
      {file.is_binary ? <Badge tone="gray" title="Nội dung nhị phân">bin</Badge> : null}
      {file.ignored ? (
        <Badge tone="yellow" title="Dữ liệu cũ trước khi có quy tắc không lưu">
          ngoài quy tắc
        </Badge>
      ) : null}
      {file.history_count !== undefined && file.history_count > 0 ? (
        <span className="vfs-dim vfs-small" title="Số bản lịch sử">
          ↻{file.history_count}
        </span>
      ) : null}
      <span className="vfs-dim vfs-small">{formatBytes(file.size)}</span>
    </span>
  );
}

/**
 * Cây file: thư mục gập/mở, icon 18px, badge bên phải, nhánh mở có đường kẻ dọc
 * dẫn hướng, click mở file. Trạng thái gập giữ trong component.
 */
export function FileTree({ files, filtered, activePath, onOpen }: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Khi có lọc, dựng cây chỉ từ các file khớp (như renderTree của trang cũ).
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const filtering = filtered.length !== files.length;

  const toggle = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const walk = (node: TreeNode): ReactNode[] => {
    const rows: ReactNode[] = [];
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of dirs) {
      const open = filtering || !collapsed.has(dir.path);
      rows.push(
        <div
          key={`dir:${dir.path}`}
          className="vfs-node"
          onClick={() => toggle(dir.path)}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle(dir.path);
            }
          }}
        >
          <span className="vfs-node-twist">{open ? "▾" : "▸"}</span>
          <IconFolder size={18} className="vfs-node-icon" />
          <span className="vfs-node-name">{`${dir.name}/`}</span>
        </div>,
      );
      if (open) {
        // Nhánh đang mở: bọc trong .vfs-level để có đường kẻ dọc dẫn hướng + thụt lề.
        rows.push(
          <div key={`level:${dir.path}`} className="vfs-level">
            {walk(dir)}
          </div>,
        );
      }
    }
    const sorted = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of sorted) {
      rows.push(
        <div
          key={`file:${file.path}`}
          className={`vfs-node${file.path === activePath ? " active" : ""}`}
          title={file.path}
          onClick={() => onOpen(file.path)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(file.path);
            }
          }}
        >
          <span className="vfs-node-twist" />
          <IconFile size={18} className="vfs-node-icon" />
          <span className="vfs-node-name">{file.path.split("/").pop()}</span>
          <FileBadges file={file} />
        </div>,
      );
    }
    return rows;
  };

  if (filtered.length === 0) {
    return (
      <div className="vfs-dim vfs-small" style={{ textAlign: "center", padding: "12px 0" }}>
        {files.length > 0
          ? "Không khớp. Thử từ khóa khác hoặc xóa trắng ô lọc."
          : "Workspace trống — bấm + File hoặc phím N để tạo file đầu tiên."}
      </div>
    );
  }
  return <div className="vfs-tree">{walk(tree)}</div>;
}
