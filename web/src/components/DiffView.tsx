import { useMemo } from "react";

interface DiffViewProps {
  /** Diff text thô dạng unified (do backend `compare` trả về). */
  diff: string;
  /** Số dòng tối đa hiển thị trước khi cắt (tránh render khổng lồ). */
  maxLines?: number;
}

interface DiffLine {
  kind: "add" | "del" | "hunk" | "meta" | "context";
  text: string;
}

const KIND_COLOR: Record<DiffLine["kind"], string | undefined> = {
  add: "var(--color-success-soft)",
  del: "var(--color-danger-soft)",
  hunk: "var(--color-accent-soft)",
  meta: undefined,
  context: undefined,
};

const KIND_TEXT_COLOR: Record<DiffLine["kind"], string | undefined> = {
  add: "var(--color-success)",
  del: "var(--color-danger)",
  hunk: "var(--color-accent)",
  meta: "var(--color-text-muted)",
  context: undefined,
};

/** Phân loại một dòng của unified diff. */
function classify(line: string): DiffLine {
  if (line.startsWith("@@")) return { kind: "hunk", text: line };
  if (line.startsWith("+")) return { kind: "add", text: line };
  if (line.startsWith("-")) return { kind: "del", text: line };
  if (line.startsWith("diff ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) {
    return { kind: "meta", text: line };
  }
  return { kind: "context", text: line };
}

/** Render unified diff: dòng +/- nền xanh/đỏ nhạt, hunk @@ nền accent nhạt, font mono. */
export function DiffView({ diff, maxLines = 2000 }: DiffViewProps) {
  const lines = useMemo<readonly DiffLine[]>(() => {
    const all = diff.split("\n").map(classify);
    // Bỏ dòng trống cuối (do split("\n") tạo ra).
    const last = all[all.length - 1];
    const trimmed = last !== undefined && last.text.length === 0 ? all.slice(0, -1) : all;
    return trimmed.length > maxLines ? trimmed.slice(0, maxLines) : trimmed;
  }, [diff, maxLines]);

  if (lines.length === 0) {
    return <div className="mono" style={{ color: "var(--color-text-muted)" }}>Không có thay đổi.</div>;
  }

  return (
    <div
      className="mono"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-control)",
        overflow: "auto",
        fontSize: "var(--font-size-sm)",
        background: "var(--color-surface)",
      }}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          style={{
            background: KIND_COLOR[line.kind],
            color: KIND_TEXT_COLOR[line.kind] ?? "var(--color-text)",
            padding: "1px 10px",
            whiteSpace: "pre",
          }}
        >
          {line.text.length > 0 ? line.text : " "}
        </div>
      ))}
    </div>
  );
}
