import { formatBytes } from "@/lib/format";
import type { OverviewSettings } from "./types";

/** Bảng "Ngưỡng cấu hình" — các ngưỡng inline/blob/quota/lịch sử từ overview. */
export function SettingsPanel({ settings }: { settings: OverviewSettings }) {
  const rows: Array<[string, string]> = [
    ["inline ≤", formatBytes(settings.inline_max_bytes)],
    ["blob rời ≥", formatBytes(settings.blob_sidecar_min_bytes)],
    ["hạn mức", formatBytes(settings.workspace_quota_bytes)],
    ["lịch sử", `${settings.max_revisions_per_file} bản/file`],
    ["data_dir", settings.data_dir],
  ];
  return (
    <dl className="vfs-kv">
      {rows.map(([key, value]) => (
        <div key={key} className="vfs-kv-pair">
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
