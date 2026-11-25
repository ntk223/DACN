/**
 * PolicyPanel.tsx — kiểm tra lệnh qua bộ chặn 2 lớp (POST /algo/policy).
 * KHÔNG chạy lệnh thật — chỉ hiển thị cho phép / chặn / cảnh báo + lý do.
 */
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { sandboxApi } from "./sandboxApi";
import type { PolicyResult } from "./types";

interface PolicyPanelProps {
  notify: (message: string, kind?: "ok" | "err" | "warn") => void;
}

export function PolicyPanel({ notify }: PolicyPanelProps) {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const trimmed = command.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      setResult(await sandboxApi.policy(trimmed));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Kiểm tra thất bại", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Kiểm tra lệnh (không chạy thật)">
      <div className="sbx-toolbar">
        <input
          className="input sbx-cmdline"
          type="text"
          aria-label="Lệnh cần kiểm tra qua bộ chặn"
          placeholder="lệnh cần thử qua bộ chặn, vd: rm -rf /"
          spellCheck={false}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void check();
          }}
        />
        <Button size="sm" variant="primary" loading={busy} onClick={() => void check()}>
          Kiểm tra
        </Button>
      </div>

      {result === null ? (
        <div className="sbx-meta" style={{ marginTop: 8 }}>
          Bộ chặn 2 lớp sẽ phân tích cú pháp và quy tắc — lệnh không được thực thi.
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="sbx-badges">
            {result.blocked ? <Badge tone="red">⛔ BỊ CHẶN</Badge> : <Badge tone="green">✓ Cho phép chạy</Badge>}
            <Badge title="Chế độ lớp 1 (quy tắc cứng)">
              lớp 1: {result.modes.layer1}
            </Badge>
            <Badge title="Chế độ lớp 2 (phân tích ngữ nghĩa)">
              lớp 2: {result.modes.layer2}
            </Badge>
          </div>

          {result.hits.length === 0 && result.warnings.length === 0 ? (
            <div className="sbx-meta" style={{ color: "var(--color-success)" }}>
              Không vi phạm quy tắc nào.
            </div>
          ) : null}

          {result.hits.map((hit) => (
            <div key={`${hit.rule}-${hit.match}`} className="sbx-meta">
              <Badge tone={hit.layer === 1 ? "red" : "yellow"}>lớp {hit.layer}</Badge>{" "}
              <span className="sbx-mono">{hit.rule}</span> — {hit.message}{" "}
              <span className="sbx-mono">({hit.match})</span>
            </div>
          ))}

          {result.warnings.map((warning) => (
            <div key={warning} className="sbx-meta" style={{ color: "var(--color-warning)" }}>
              ⚠ {warning}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
