import { useMemo } from "react";

import { collapseContext, isDiffRow, lineDiff } from "./diff";

interface LineDiffViewProps {
  /** Văn bản cũ. */
  before: string;
  /** Văn bản mới. */
  after: string;
  /** Chiều cao tối đa của khối diff (px). */
  maxHeight?: number;
}

/**
 * Render diff theo dòng: cột số dòng cũ/mới, dấu +/−, nền xanh/đỏ nhạt;
 * thu gọn đoạn giống nhau dài (giữ 3 dòng ngữ cảnh) như trang cũ.
 */
export function LineDiffView({ before, after, maxHeight = 380 }: LineDiffViewProps) {
  const rows = useMemo(() => collapseContext(lineDiff(before, after)), [before, after]);
  const hasChanges = rows.some((row) => isDiffRow(row) && row.kind !== "eq");

  if (!hasChanges) {
    return <div className="vfs-dim vfs-small">Không có khác biệt.</div>;
  }

  return (
    <div className="vfs-diff" style={{ maxHeight }}>
      {rows.map((row, index) => {
        if (!isDiffRow(row)) {
          return (
            <div key={index} className="vfs-diff-line vfs-diff-skip">
              <span />
              <span />
              <span />
              <span>{`⋯ ${row.count} dòng giống nhau`}</span>
            </div>
          );
        }
        const kindClass = row.kind === "add" ? " vfs-diff-add" : row.kind === "del" ? " vfs-diff-del" : "";
        return (
          <div key={index} className={`vfs-diff-line${kindClass}`}>
            <span>{row.a ?? ""}</span>
            <span>{row.b ?? ""}</span>
            <span>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
            <span>{row.text}</span>
          </div>
        );
      })}
    </div>
  );
}
