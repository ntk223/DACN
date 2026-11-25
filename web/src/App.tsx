import { useCallback, useEffect, useState } from "react";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { SandboxManagePage } from "@/features/sandbox/SandboxManagePage";
import { SandboxOpsPage } from "@/features/sandbox/SandboxOpsPage";
import { VfsManagePage } from "@/features/vfs/VfsManagePage";
import { VfsOpsPage } from "@/features/vfs/VfsOpsPage";
import type { SandboxOpsRequest, VfsManageRequest, VfsOpsRequest } from "@/lib/nav";

type Active = "overview" | "vfs-ops" | "vfs-manage" | "sandbox-ops" | "sandbox-manage";

interface NavItem {
  key: Active;
  label: string;
  /** Tiêu đề hiển thị ở header. */
  title: string;
  /** Mô tả ngắn — tooltip trên mục điều hướng + dòng phụ dưới tiêu đề header. */
  description: string;
}

interface NavGroup {
  /** Nhãn nhóm — chữ nhỏ uppercase muted phía trên các mục. */
  label: string;
  items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Tổng quan",
    items: [
      { key: "overview", label: "Tổng quan", title: "Tổng quan", description: "Dashboard + console MCP" },
    ],
  },
  {
    label: "Kho file (VFS)",
    items: [
      {
        key: "vfs-ops",
        label: "Thao tác",
        title: "VFS · Thao tác",
        description: "Cây file + trình sửa — việc hằng ngày",
      },
      {
        key: "vfs-manage",
        label: "Quản lý",
        title: "VFS · Quản lý",
        description: "Workspace, hạn mức, lịch sử, thuật toán",
      },
    ],
  },
  {
    label: "Sandbox",
    items: [
      {
        key: "sandbox-ops",
        label: "Thao tác",
        title: "Sandbox · Thao tác",
        description: "Chạy lệnh, xem file, log trong sandbox đang chạy",
      },
      {
        key: "sandbox-manage",
        label: "Quản lý",
        title: "Sandbox · Quản lý",
        description: "Vòng đời phiên, bật/dừng, mồ côi",
      },
    ],
  },
];

/** Icon SVG inline 20x20, stroke theo màu chữ hiện tại (currentColor). */
function NavIcon({ name }: { name: Active }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    flexShrink: 0,
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
  if (name === "vfs-ops") {
    return (
      <svg {...common}>
        {/* file + bút chì: sửa file trong kho */}
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
        <path d="M14 3v4h4" />
        <path d="M20.5 10.5a1.5 1.5 0 0 0-2.1-2.1L13 13.8V16h2.2z" />
      </svg>
    );
  }
  if (name === "vfs-manage") {
    return (
      <svg {...common}>
        {/* thư viện / database: quản trị kho file */}
        <ellipse cx="12" cy="5.5" rx="8" ry="2.5" />
        <path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
        <path d="M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
      </svg>
    );
  }
  if (name === "sandbox-ops") {
    return (
      <svg {...common}>
        {/* terminal: chạy lệnh trong sandbox */}
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9l3 3-3 3" />
        <path d="M12 15h5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      {/* hộp / container: vòng đời sandbox */}
      <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z" />
      <path d="M4 6.5l8 4.5 8-4.5" />
      <path d="M12 11v9" />
    </svg>
  );
}

interface HealthState {
  ok: boolean;
  /** Thời điểm kiểm tra gần nhất (epoch ms) — tooltip trên dot. */
  checkedAt: number;
  /** Phiên bản gateway từ /health — hiển thị ở footer sidebar. */
  version: string | null;
}

/** Shell chính: sidebar trái cố định + header + vùng nội dung feature. */
export function App() {
  const [active, setActive] = useState<Active>("overview");
  const [health, setHealth] = useState<HealthState>({ ok: false, checkedAt: 0, version: null });
  // Yêu cầu "Quản lý → Thao tác" kèm đối tượng: bấm vào item nào ở trang Quản lý
  // thì trang Thao tác mở đúng item đó (nonce để bắt cả lần trùng giá trị cũ).
  const [vfsOpsRequest, setVfsOpsRequest] = useState<VfsOpsRequest | null>(null);
  const [sandboxOpsRequest, setSandboxOpsRequest] = useState<SandboxOpsRequest | null>(null);
  const [vfsManageRequest, setVfsManageRequest] = useState<VfsManageRequest | null>(null);

  const openVfsOps = useCallback((workspaceId?: string, file?: string) => {
    setVfsOpsRequest({ workspaceId, file, nonce: Date.now() });
    setActive("vfs-ops");
  }, []);

  const openSandboxOps = useCallback((sessionId: string) => {
    setSandboxOpsRequest({ sessionId, nonce: Date.now() });
    setActive("sandbox-ops");
  }, []);

  const openVfsManage = useCallback((workspaceId?: string, file?: string) => {
    setVfsManageRequest({ workspaceId, file, nonce: Date.now() });
    setActive("vfs-manage");
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch("/health", { headers: { Accept: "application/json" } });
      let version: string | null = null;
      try {
        const data = (await response.json()) as { version?: unknown };
        if (typeof data.version === "string") version = data.version;
      } catch {
        // body không phải JSON — bỏ qua, vẫn giữ trạng thái ok theo response.
      }
      setHealth({ ok: response.ok, checkedAt: Date.now(), version });
    } catch {
      setHealth({ ok: false, checkedAt: Date.now(), version: null });
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const intervalId = window.setInterval(() => void checkHealth(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [checkHealth]);

  const currentItem = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.key === active);

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
          padding: "var(--space-4) var(--space-3)",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 var(--space-2) var(--space-5)",
            fontWeight: 700,
            fontSize: "var(--font-size-lg)",
            color: "var(--color-text)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

        {/* Điều hướng: nhóm có nhãn nhỏ uppercase muted */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div
                style={{
                  padding: "0 var(--space-3)",
                  paddingTop: "var(--space-2)",
                  paddingBottom: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-text-faint)",
                }}
              >
                {group.label}
              </div>
              {group.items.map((item) => {
                const isActive = item.key === active;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActive(item.key)}
                    aria-current={isActive ? "page" : undefined}
                    title={item.description}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      appearance: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      height: 40,
                      padding: "0 var(--space-3)",
                      borderRadius: "var(--radius-control)",
                      background: isActive ? "var(--color-accent-soft)" : "transparent",
                      color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                      fontSize: "14px",
                      fontWeight: 500,
                      borderLeft: isActive ? "3px solid var(--color-accent)" : "3px solid transparent",
                      transition: "background 0.12s ease, color 0.12s ease",
                    }}
                    onMouseEnter={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.background = "var(--color-surface-hover)";
                        event.currentTarget.style.color = "var(--color-text)";
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.background = "transparent";
                        event.currentTarget.style.color = "var(--color-text-muted)";
                      }
                    }}
                  >
                    <NavIcon name={item.key} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer sidebar: phiên bản app */}
        <div
          style={{
            marginTop: "auto",
            padding: "var(--space-3) var(--space-2) 0",
            borderTop: "1px solid var(--color-border)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-faint)",
          }}
        >
          {health.version !== null ? (
            <span title="Phiên bản gateway">
              Gateway <span className="mono">v{health.version}</span>
            </span>
          ) : (
            <span>Sandbox Kit Admin</span>
          )}
        </div>
      </aside>

      {/* ---- Cột phải: header + nội dung ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            minHeight: "var(--header-height)",
            flexShrink: 0,
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "10px var(--space-6)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "var(--font-size-h1)", fontWeight: 650, lineHeight: 1.25 }}>
              {currentItem?.title ?? "Sandbox Kit"}
            </h1>
            {currentItem !== undefined ? (
              <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
                {currentItem.description}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexShrink: 0 }}>
            {/* Trạng thái gateway: dot + chữ */}
            <span
              title={
                health.ok
                  ? "Gateway hoạt động bình thường"
                  : `Không kết nối được gateway (kiểm tra lúc ${new Date(health.checkedAt).toLocaleTimeString("vi-VN")})`
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                background: health.ok ? "var(--color-success-soft)" : "var(--color-danger-soft)",
                color: health.ok ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: health.ok ? "var(--color-success)" : "var(--color-danger)",
                }}
              />
              {health.ok ? "Hoạt động" : "Mất kết nối"}
            </span>

            {/* Badge môi trường dev */}
            <span
              title="Môi trường dev"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--color-accent-soft-border)",
                background: "var(--color-accent-soft)",
                color: "var(--color-accent)",
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              dev
            </span>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: "auto", padding: "var(--space-6)" }}>
          {active === "overview" ? (
            <OverviewPage />
          ) : active === "vfs-ops" ? (
            <VfsOpsPage
              navRequest={vfsOpsRequest ?? undefined}
              onOpenManage={openVfsManage}
              onOpenSandboxOps={openSandboxOps}
            />
          ) : active === "vfs-manage" ? (
            <VfsManagePage onOpenOps={openVfsOps} navRequest={vfsManageRequest ?? undefined} />
          ) : active === "sandbox-ops" ? (
            <SandboxOpsPage navRequest={sandboxOpsRequest ?? undefined} />
          ) : (
            <SandboxManagePage onOpenOps={openSandboxOps} />
          )}
        </main>
      </div>
    </div>
  );
}
