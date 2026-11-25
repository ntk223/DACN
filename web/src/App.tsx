import { useCallback, useEffect, useState } from "react";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { SandboxPage } from "@/features/sandbox/SandboxPage";
import { VfsPage } from "@/features/vfs/VfsPage";

type Active = "overview" | "vfs" | "sandbox";

interface NavItem {
  key: Active;
  label: string;
  /** Tiêu đề hiển thị ở header. */
  title: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: "overview", label: "Tổng quan", title: "Tổng quan" },
  { key: "vfs", label: "VFS", title: "Quản lý VFS" },
  { key: "sandbox", label: "Sandbox", title: "Quản lý Sandbox" },
];

/** Icon SVG inline 20x20, stroke theo màu chữ hiện tại (currentColor). */
function NavIcon({ name }: { name: Active }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "overview") {
    return (
      <svg {...common}>
        {/* gauge: đồng hồ tổng quan */}
        <path d="M4 14a8 8 0 1 1 16 0" />
        <path d="M12 14l3.5-3.5" />
        <path d="M4 14v2m16-2v2" />
      </svg>
    );
  }
  if (name === "vfs") {
    return (
      <svg {...common}>
        {/* folder: hệ thống file */}
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      {/* terminal: sandbox/exec */}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M12 15h5" />
    </svg>
  );
}

interface HealthState {
  ok: boolean;
  /** Thời điểm kiểm tra gần nhất (epoch ms) — tooltip trên dot. */
  checkedAt: number;
}

/** Shell chính: sidebar trái cố định + header mỏng + vùng nội dung feature. */
export function App() {
  const [active, setActive] = useState<Active>("overview");
  const [health, setHealth] = useState<HealthState>({ ok: false, checkedAt: 0 });

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch("/health", { headers: { Accept: "application/json" } });
      setHealth({ ok: response.ok, checkedAt: Date.now() });
    } catch {
      setHealth({ ok: false, checkedAt: Date.now() });
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const intervalId = window.setInterval(() => void checkHealth(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [checkHealth]);

  const currentItem = NAV_ITEMS.find((item) => item.key === active);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ---- Sidebar trái cố định ---- */}
      <aside
        style={{
          width: "var(--sidebar-width)",
          flexShrink: 0,
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          padding: "var(--space-4) var(--space-2)",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 var(--space-3) var(--space-4)",
            fontWeight: 700,
            fontSize: "var(--font-size-lg)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" fill="var(--color-accent)" />
            <path
              d="M8 12.5l2.5 2.5L16 9.5"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Sandbox Kit</span>
        </div>

        {/* Điều hướng */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(item.key)}
                aria-current={isActive ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  appearance: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "9px var(--space-3)",
                  borderRadius: "var(--radius-control)",
                  background: isActive ? "var(--color-accent-soft)" : "transparent",
                  color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                  fontWeight: isActive ? 600 : 400,
                  borderLeft: isActive ? "3px solid var(--color-accent)" : "3px solid transparent",
                  transition: "background 0.12s ease, color 0.12s ease",
                }}
                onMouseEnter={(event) => {
                  if (!isActive) event.currentTarget.style.background = "var(--color-surface-hover)";
                }}
                onMouseLeave={(event) => {
                  if (!isActive) event.currentTarget.style.background = "transparent";
                }}
              >
                <NavIcon name={item.key} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ---- Cột phải: header mỏng + nội dung ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            height: "var(--header-height)",
            flexShrink: 0,
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 var(--space-6)",
          }}
        >
          <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600 }}>
            {currentItem?.title ?? "Sandbox Kit"}
          </h1>
          <span
            title={
              health.ok
                ? "Gateway hoạt động bình thường"
                : `Không kết nối được gateway (kiểm tra lúc ${new Date(health.checkedAt).toLocaleTimeString("vi-VN")})`
            }
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: health.ok ? "var(--color-success)" : "var(--color-danger)",
              boxShadow: `0 0 0 3px ${health.ok ? "var(--color-success-soft)" : "var(--color-danger-soft)"}`,
            }}
          />
        </header>

        <main style={{ flex: 1, overflowY: "auto", padding: "var(--space-5) var(--space-6)" }}>
          {active === "overview" ? <OverviewPage /> : active === "vfs" ? <VfsPage /> : <SandboxPage />}
        </main>
      </div>
    </div>
  );
}
