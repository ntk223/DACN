/**
 * diff.ts — diff theo dòng (LCS) + thu gọn đoạn giống nhau, port từ trang vfs.html cũ.
 * Không phụ thuộc React.
 */

export type LineDiffKind = "eq" | "add" | "del";

export interface LineDiffRow {
  kind: LineDiffKind;
  /** Số dòng bên văn bản cũ (null nếu là dòng thêm). */
  a: number | null;
  /** Số dòng bên văn bản mới (null nếu là dòng xóa). */
  b: number | null;
  text: string;
}

/** Một mục sau khi thu gọn: dòng diff hoặc nhãn "⋯ N dòng giống nhau". */
export type CollapsedRow = LineDiffRow | { kind: "skip"; count: number };

export function isDiffRow(row: CollapsedRow): row is LineDiffRow {
  return row.kind !== "skip";
}

/** Diff theo dòng bằng LCS — quá lớn (A·B > 4 triệu ô) thì bỏ qua để tránh treo. */
export function lineDiff(before: string, after: string): LineDiffRow[] {
  const A = before.split("\n");
  const B = after.split("\n");
  if (A.length * B.length > 4e6) {
    return [{ kind: "del", a: 1, b: null, text: "(file quá lớn để diff)" }];
  }
  const n = A.length;
  const m = B.length;
  // dp[i][j] = độ dài LCS của A[i..] và B[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const aLine = A[i] ?? "";
      const bLine = B[j] ?? "";
      const diag = (dp[i + 1]?.[j + 1] ?? 0) + 1;
      const down = dp[i + 1]?.[j] ?? 0;
      const right = dp[i]?.[j + 1] ?? 0;
      dp[i]![j] = aLine === bLine ? diag : Math.max(down, right);
    }
  }
  const out: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const aLine = A[i] ?? "";
    const bLine = B[j] ?? "";
    if (aLine === bLine) {
      out.push({ kind: "eq", a: i + 1, b: j + 1, text: aLine });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "del", a: i + 1, b: null, text: aLine });
      i++;
    } else {
      out.push({ kind: "add", a: null, b: j + 1, text: bLine });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", a: i + 1, b: null, text: A[i] ?? "" });
    i++;
  }
  while (j < m) {
    out.push({ kind: "add", a: null, b: j + 1, text: B[j] ?? "" });
    j++;
  }
  return out;
}

/** Giữ các dòng khác nhau + `context` dòng kề; gom phần còn lại thành nhãn "⋯ N dòng". */
export function collapseContext(rows: LineDiffRow[], context = 3): CollapsedRow[] {
  const keep = rows.map((row, index) => {
    if (row.kind !== "eq") return true;
    const window = rows.slice(Math.max(0, index - context), index + context + 1);
    return window.some((r) => r.kind !== "eq");
  });
  const out: CollapsedRow[] = [];
  let skipped = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (!keep[index]) {
      skipped++;
      continue;
    }
    if (skipped > 0) {
      out.push({ kind: "skip", count: skipped });
      skipped = 0;
    }
    out.push(row);
  }
  if (skipped > 0) out.push({ kind: "skip", count: skipped });
  return out;
}
