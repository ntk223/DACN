/**
 * LogsPanel.tsx — log container (GET /sandboxes/{id}/logs?tail=N).
 * Khung pre mono tự cuộn xuống cuối sau khi tải.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { sandboxApi } from "./sandboxApi";

interface LogsPanelProps {
  sandboxId: string;
  /** Provider có hỗ trợ log không (capabilities.diagnostics). */
  supported: boolean;
  notify: (message: string, kind?: "ok" | "err" | "warn") => void;
}

const TAIL_DEFAULT = 200;

export function LogsPanel({ sandboxId, supported, notify }: LogsPanelProps) {
  const [logs, setLogs] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  // Đổi sandbox → xóa log cũ.
  useEffect(() => {
    setLogs(null);
  }, [sandboxId]);

  // Sau khi có log mới, cuộn xuống cuối.
  useEffect(() => {
    const node = preRef.current;
    if (node && logs !== null) node.scrollTop = node.scrollHeight;
  }, [logs]);

  if (!supported) {
    return (
      <Card title="Log container">
        <div className="sbx-meta">Provider không hỗ trợ xem log.</div>
      </Card>
    );
  }

  const load = async () => {
    setLoading(true);
    try {
      const result = await sandboxApi.logs(sandboxId, TAIL_DEFAULT);
      setLogs(result.available ? (result.logs ?? "(chưa có log)") : "Provider không hỗ trợ log.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Tải log thất bại", "err");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="Log container"
      actions={
        <Button size="sm" loading={loading} onClick={() => void load()}>
          Tải log (tail={TAIL_DEFAULT})
        </Button>
      }
    >
      <pre ref={preRef} className="sbx-pre">
        {logs ?? "Bấm “Tải log” để xem log container."}
      </pre>
    </Card>
  );
}
