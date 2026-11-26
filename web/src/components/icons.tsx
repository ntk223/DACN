/**
 * icons.tsx — hệ icon SVG tập trung cho toàn app (stroke currentColor).
 * Không dùng thư viện ngoài. Kích thước mặc định 20px để khớp chuẩn design system.
 * Quy tắc: feature KHÔNG tự define SVG inline nữa — import từ đây (xem UX-GUIDE.md mục Icon).
 * Tên export giữ nguyên các icon đã có ở features/overview/icons.tsx để chuyển import dễ dàng.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className,
  };
}

/* ---- Icon từ features/overview/icons.tsx (giữ nguyên path + tên) ---- */

export function IconFolder({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function IconClock({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

export function IconPlay({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
    </svg>
  );
}

export function IconStop({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
    </svg>
  );
}

export function IconBox({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8Z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

export function IconDatabase({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}

export function IconSearch({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

export function IconWarn({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <line x1="12" y1="17.3" x2="12" y2="17.4" />
    </svg>
  );
}

export function IconCheckCircle({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12.5 11 15.5 16.5 9.5" />
    </svg>
  );
}

export function IconErrorCircle({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <line x1="12" y1="16.3" x2="12" y2="16.4" />
    </svg>
  );
}

export function IconTrash({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <polyline points="4 7 20 7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M9.5 7V4h5v3" />
    </svg>
  );
}

export function IconUpload({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 16V4" />
      <polyline points="7 9 12 4 17 9" />
      <path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3" />
    </svg>
  );
}

export function IconDownload({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 4v12" />
      <polyline points="7 11 12 16 17 11" />
      <path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3" />
    </svg>
  );
}

/* ---- Icon bổ sung (tổng hợp từ các chỗ define rải rác trong feature) ---- */

/** Bút chì — từ WorkspaceList.tsx (nút "Sửa file này"). */
export function IconPencil({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}

/** Terminal — từ WorkspaceInfoBar.tsx / App.tsx (nút "Sang Sandbox", nav sandbox). */
export function IconTerminal({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M12 15h5" />
    </svg>
  );
}

/** File tài liệu — từ FileTree.tsx (node file trong cây thư mục). */
export function IconFile({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/** Mũi tên xuống + đường kẻ — từ SyncPanel.tsx (nút pull-back về kho). */
export function IconArrowDown({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3v11" />
      <path d="m7 9 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

/** Dấu cộng — thêm mới (workspace, phiên…). */
export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** Mũi tên vòng — tải lại / làm mới. */
export function IconRefresh({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 11a8 8 0 1 0-2.34 6.34" />
      <polyline points="20 5 20 11 14 11" />
    </svg>
  );
}

/* ---- Icon bổ sung sau đợt gom (từ App.tsx) ---- */

/** Đồng hồ gauge — trang Tổng quan. */
export function IconGauge({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      {/* gauge: đồng hồ tổng quan */}
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l3.5-3.5" />
      <path d="M4 14v2m16-2v2" />
    </svg>
  );
}

/**
 * Logo brand (ô vuông bo góc + dấu tích) — fill 2 màu nên không dùng svgProps
 * (svgProps là stroke currentColor). Giữ prop size/className + aria-hidden như các icon khác.
 */
export function IconBrand({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" fill="var(--color-accent)" />
      <path
        d="M8 12.5l2.5 2.5L16 9.5"
        stroke="var(--color-text-on-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
