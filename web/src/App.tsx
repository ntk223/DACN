/**
 * App.tsx — shell chính: sidebar trái + header + vùng nội dung feature.
 * Đợt 2 refactor UI/UX: toàn bộ inline style của shell chuyển sang app-shell.css
 * (class .shell-*), responsive qua media query trong CSS — xem app-shell.css.
 * Logo brand giữ SVG inline riêng (logo app, không thuộc bộ icon chung).
 */

import { useCallback, useEffect, useState } from "react";

import {
  IconBrand,
  IconBox,
  IconDatabase,
  IconFile,
  IconGauge,
  IconTerminal,
} from "@/components/icons";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { SandboxManagePage } from "@/features/sandbox/SandboxManagePage";
import { SandboxOpsPage } from "@/features/sandbox/SandboxOpsPage";
import { VfsManagePage } from "@/features/vfs/VfsManagePage";
import { VfsOpsPage } from "@/features/vfs/VfsOpsPage";
import type { SandboxOpsRequest, VfsManageRequest, VfsOpsRequest } from "@/lib/nav";

import "./app-shell.css";

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

/**
 * Icon nav — map key → icon tập trung ở components/icons (thay 6 SVG inline cũ).
 */
function NavIcon({ name }: { name: Active }) {
  // overview: đồng hồ gauge
  if (name === "overview") return <IconGauge />;
  // vfs-ops: file (cũ là file + bút chì ghép — IconFile là icon gần nhất có sẵn)
  if (name === "vfs-ops") return <IconFile />;
  // vfs-manage: thư viện / database
  if (name === "vfs-manage") return <IconDatabase />;
  // sandbox-ops: terminal
  if (name === "sandbox-ops") return <IconTerminal />;
  // sandbox-manage: hộp / container
  return <IconBox />;
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
    <div className="shell">
      {/* ---- Sidebar trái cố định (mobile ≤640px: thành thanh nav ngang cuộn) ---- */}
      <aside className="shell-sidebar">
        {/* Logo */}
        <div className="shell-brand">
          <IconBrand />
          <span>Sandbox Kit</span>
        </div>

        {/* Điều hướng: nhóm có nhãn nhỏ uppercase muted */}
        <nav className="shell-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const isActive = item.key === active;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={isActive ? "nav-item active" : "nav-item"}
                    onClick={() => setActive(item.key)}
                    aria-current={isActive ? "page" : undefined}
                    title={item.description}
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
        <div className="shell-sidebar-footer">
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
      <div className="shell-content">
        <header className="shell-header">
          <div className="shell-header-title">
            <h1 className="shell-title">{currentItem?.title ?? "Sandbox Kit"}</h1>
            {currentItem !== undefined ? (
              <div className="shell-subtitle">{currentItem.description}</div>
            ) : null}
          </div>

          <div className="shell-header-actions">
            {/* Trạng thái gateway: dot + chữ */}
            <span
              className={health.ok ? "status-pill is-ok" : "status-pill"}
              title={
                health.ok
                  ? "Gateway hoạt động bình thường"
                  : `Không kết nối được gateway (kiểm tra lúc ${new Date(health.checkedAt).toLocaleTimeString("vi-VN")})`
              }
            >
              <span className="status-dot" aria-hidden="true" />
              {health.ok ? "Hoạt động" : "Mất kết nối"}
            </span>

            {/* Badge môi trường dev */}
            <span className="env-badge" title="Môi trường dev">
              dev
            </span>
          </div>
        </header>

        <main className="shell-main">
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
