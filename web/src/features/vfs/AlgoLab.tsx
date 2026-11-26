import { useState } from "react";

import { Button } from "@/components/Button";
import { LineDiffView } from "./LineDiffView";
import { errorMessage, vfsApi } from "./vfsApi";
import type { FuzzyAlgoResult, PathAlgoResult } from "./types";

/** Vài ví dụ đường dẫn để thử nhanh chuẩn hóa + quy tắc không lưu. */
const PATH_PRESETS: readonly string[] = [
  "src/app.py",
  "/src/./lib/../app.py",
  "C:\\Users\\a\\x.py",
  "../etc/passwd",
  "node_modules/x/i.js",
  ".venv/lib/site.py",
  "src/__pycache__/a.pyc",
  "pkg.egg-info/PKG-INFO",
  "dist/app.js",
  "src/.DS_Store",
  "docs/tài-liệu.md",
];

const DEFAULT_CONTENT = `def total(items):
    result = 0
    for x in items:
        result += x
    return result
`;

const DEFAULT_OLD = `for   x in items:
  result  += x`;

const DEFAULT_NEW = `for x in items:
result += x * 2`;

/**
 * Tab "Thuật toán": chạy các hàm thuần của VFS (chuẩn hóa đường dẫn, khớp mờ)
 * — không ghi gì vào kho; lỗi nghiệp vụ trả dạng dữ liệu (ok=false).
 */
export function AlgoLab() {
  const [pathInput, setPathInput] = useState("/src/../node_modules\\pkg/index.js");
  const [pathResult, setPathResult] = useState<PathAlgoResult | null>(null);
  const [pathBusy, setPathBusy] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [oldText, setOldText] = useState(DEFAULT_OLD);
  const [newText, setNewText] = useState(DEFAULT_NEW);
  const [fuzzyResult, setFuzzyResult] = useState<FuzzyAlgoResult | null>(null);
  const [fuzzyBusy, setFuzzyBusy] = useState(false);
  const [fuzzyError, setFuzzyError] = useState<string | null>(null);

  const runPath = async (path: string) => {
    setPathInput(path);
    setPathBusy(true);
    try {
      setPathResult(await vfsApi.algoPath(path));
      setPathError(null);
    } catch (error) {
      // Endpoint luôn trả 200 kèm ok=false, hiếm khi vào đây (mất kết nối…).
      setPathResult(null);
      setPathError(errorMessage(error));
    } finally {
      setPathBusy(false);
    }
  };

  const runFuzzy = async () => {
    setFuzzyBusy(true);
    try {
      setFuzzyResult(await vfsApi.algoFuzzy({ content, old_text: oldText, new_text: newText }));
      setFuzzyError(null);
    } catch (error) {
      setFuzzyResult(null);
      setFuzzyError(errorMessage(error));
    } finally {
      setFuzzyBusy(false);
    }
  };

  return (
    <div className="vfs-dim vfs-small">
      Chạy trực tiếp các hàm thuần của VFS — không ghi gì vào kho.
      <div className="vfs-sub">
        <h3 className="vfs-sub-title">Chuẩn hóa đường dẫn + quy tắc không lưu (thư viện / build / cache)</h3>
        <input
          className="input mono"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runPath(pathInput);
          }}
        />
        <div className="vfs-row" style={{ marginTop: 8 }}>
          {PATH_PRESETS.map((preset) => (
            <Button key={preset} size="sm" disabled={pathBusy} onClick={() => void runPath(preset)}>
              {preset}
            </Button>
          ))}
        </div>
        <div className="vfs-row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" loading={pathBusy} onClick={() => void runPath(pathInput)}>
            Chạy
          </Button>
        </div>
        {pathError !== null ? (
          <div className="vfs-small" style={{ marginTop: 10, color: "var(--color-danger)" }}>
            {pathError}
          </div>
        ) : null}
        {pathResult !== null ? (
          <dl className="kv" style={{ marginTop: 10 }}>
            <div className="kv-pair">
              <dt>canonical</dt>
              <dd className="mono">{pathResult.canonical ?? "—"}</dd>
            </div>
            <div className="kv-pair">
              <dt>đã đổi</dt>
              <dd>{pathResult.canonical !== undefined ? (pathResult.changed ? "có" : "không") : "—"}</dd>
            </div>
            <div className="kv-pair">
              <dt>kết quả</dt>
              <dd style={{ color: pathResult.ok ? "var(--color-success)" : "var(--color-danger)" }}>
                {pathResult.ok
                  ? "lưu vào kho"
                  : pathResult.error !== undefined
                    ? `${pathResult.error.code} — ${pathResult.error.message}`
                    : "không lưu"}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="vfs-sub">
        <h3 className="vfs-sub-title">Sửa khớp mờ 3 mức (trên văn bản tùy ý)</h3>
        <textarea className="textarea" rows={6} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
        <div className="vfs-row" style={{ marginTop: 8, alignItems: "stretch" }}>
          <textarea className="textarea vfs-grow" rows={3} value={oldText} placeholder="old_text" onChange={(e) => setOldText(e.target.value)} spellCheck={false} />
          <textarea className="textarea vfs-grow" rows={3} value={newText} placeholder="new_text" onChange={(e) => setNewText(e.target.value)} spellCheck={false} />
        </div>
        <div className="vfs-row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" loading={fuzzyBusy} onClick={() => void runFuzzy()}>
            Chạy
          </Button>
        </div>
        {fuzzyError !== null ? (
          <div className="vfs-small" style={{ marginTop: 8, color: "var(--color-danger)" }}>
            {fuzzyError}
          </div>
        ) : null}
        {fuzzyResult !== null ? (
          fuzzyResult.ok ? (
            <>
              <div className="vfs-small" style={{ marginTop: 8, color: "var(--color-success)" }}>
                {fuzzyResult.level === 1
                  ? "Mức 1 — khớp chính xác đúng 1 lần"
                  : "Mức 2 — khớp mờ theo dòng, giữ indent gốc"}
              </div>
              {fuzzyResult.result !== undefined ? (
                <div style={{ marginTop: 8 }}>
                  <LineDiffView before={content} after={fuzzyResult.result} maxHeight={300} />
                </div>
              ) : null}
            </>
          ) : (
            <div className="vfs-small" style={{ marginTop: 8, color: "var(--color-danger)" }}>
              {`Mức 3 — ${fuzzyResult.error?.message ?? "không khớp"}`}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
