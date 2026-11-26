# UX-GUIDE — Chuẩn design system Sandbox Kit Admin (bản rà soát "dễ nhìn, dễ bấm")

> Áp dụng cho mọi trang feature (`web/src/features/*`). Theme SÁNG, không dark mode.
> Nguồn sự thật: `styles/tokens.css` + `styles/base.css`. **Cấm hardcode màu/px ở CSS feature khi đã có biến.**

## 1. Chữ & màu

| Cần | Biến / class | Giá trị |
|---|---|---|
| Body text | `--font-size-base` | 15px |
| Label, hint, badge, meta | `--font-size-sm` | 13px |
| Tiêu đề card | `--font-size-lg` | 17px |
| Tiêu đề trang | `--font-size-h1` (h1) | 22px / 700 (650 ở header) |
| Tiêu đề section | `--font-size-h2` (h2) | 18px / 650 |
| Code, hash, log | `--font-size-mono` / `.mono` | 13px mono |
| Line-height | `--line-height-body` | 1.55 |
| Chữ chính | `--color-text` | #111827 |
| Chữ phụ | `--color-text-muted` | #4b5563 |
| Chữ meta rất phụ (hash, timestamp) | `--color-text-faint` | #6b7280 |
| Chữ trên nút primary/danger | `--color-text-on-accent` | #ffffff |
| Terminal (khung tối) | `--term-bg/--term-fg/--term-muted/--term-err/--term-ok/--term-warn/--term-accent/--term-border` | palette slate (đã chuyển vào tokens) |

- Badge/label trạng thái **luôn weight ≥ 600**.
- Trạng thái màu: `--color-success` #15803d, `--color-warning` #b45309, `--color-danger` #dc2626 (đậm hơn cũ để đủ contrast trên nền soft).

## 2. Vùng bấm (đừng làm nhỏ hơn)

- `.btn`: min-height **38px**, padding ngang 16px; `.btn-sm`: **32px**.
- `.input` / `.select` / `.textarea`: min-height **38px**.
- Nút chỉ có icon: dùng thêm class **`.btn-icon`** (≥ 36px vuông).
- Mục tab: cao **40px** (Tabs component đã set sẵn).
- Hàng bảng: cao tối thiểu **44px** (padding td đã set sẵn — đừng giảm).
- Mọi control phải còn nhận được `:focus-visible` outline 2px accent — không override `outline: none` mà không thay thế.

## 3. Card & khoảng cách

- `.card`: padding **20px** (`--space-5`), shadow phân lớp `--shadow-sm` → hover `--shadow-md` + nâng 1px (tự động).
- Khoảng cách giữa các section trong trang: **24px** (`--space-6`) — dùng `gap` hoặc `margin`.
- `<main>` đã padding 24px; feature KHÔNG thêm nền/padding lớn nữa.

## 4. Bảng

- Header: nền `--table-header-bg` (#f8fafc), **sticky** (position sticky đã có), chữ 13px uppercase 600.
- Hàng hover nền `--color-surface-hover`; zebra tùy chọn: thêm class `table-zebra` vào `<table className="table table-zebra">`.

## 5. Component chung (`web/src/components/` — nền tảng dùng chung, giữ nguyên API props)

- `Button` — variant/size/loading như cũ, to và rõ hơn qua CSS.
- `Card` — title 17px/650; hàng tiêu đề dùng class `.card-head` (title trái, actions phải).
- `Badge` — weight 600, padding 3px 10px; badge có chấm tròn dùng thêm `<span className="badge-dot">` (màu theo tone qua currentColor).
- `Field` — label weight 500 màu text chính; hint 13px muted.
- `Modal` — overlay `--overlay-bg`, nút đóng `.modal-close` 36px, title 17px/650. **A11y sẵn có:** focus trap (Tab vòng trong modal), mở → focus control đầu tiên, đóng → trả focus về element trước đó; `aria-labelledby` tự sinh từ title (ReactNode cũng được).
- `Tabs` — tab cao 40px, underline accent 2px, điều hướng bàn phím Left/Right/Home/End, roving tabIndex. **Id pattern bắt buộc:** mỗi tab sinh `id="tab-{key}"` + `aria-controls="panel-{key}"` — caller đặt `id="panel-{key}"` + `role="tabpanel"` + `aria-labelledby="tab-{key}"` cho vùng nội dung.
- `ConfirmDialog` (`@/components/ConfirmDialog`) — hộp thoại xác nhận dùng chung (open/title/message/confirmLabel/danger/busy/onConfirm/onClose). **Cấm dùng `window.confirm`.**
- `Toast` (`@/components/Toast`) — bộ toast dùng chung: `useToasts()` trả `{ toasts, push }`, `ToastStack({ toasts })`. kind = `"success" | "error" | "warn" | "info"`, class `.toast-*` của base.css, có `aria-live="polite"`. Thay cho vfs/Toast + sandbox/Toast cũ.
- `StateBadge` (`@/components/StateBadge`) — badge trạng thái phiên dùng chung: `<StateBadge state={s.state} />` (superset RUNNING/STARTING/PAUSED/STANDBY/DRIFT/ERROR + nhãn tiếng Việt + tooltip); prop `label` ghi đè nhãn. Thay cho 6 chỗ map state→badge cục bộ. Riêng provider_state ("running"/"paused"…) dùng `providerTone()` của `lib/format.ts` + `Badge`.
- `Spinner`, `EmptyState` — giữ nguyên cách dùng. `Toolbar`, `DiffView` đã xóa (dead code) — không import lại.

## 5b. Icon — dùng `@/components/icons.tsx`, CẤM define SVG inline rải rác

- Toàn bộ icon tập trung ở `components/icons.tsx` (stroke currentColor, prop `{ size?, className? }`, `aria-hidden` mặc định).
- Có sẵn: `IconFolder`, `IconClock`, `IconPlay`, `IconStop`, `IconBox`, `IconDatabase`, `IconSearch`, `IconWarn`, `IconCheckCircle`, `IconErrorCircle`, `IconTrash`, `IconUpload`, `IconDownload`, `IconPencil`, `IconTerminal`, `IconFile`, `IconArrowDown`, `IconPlus`, `IconRefresh`.
- Icon mới phải thêm vào đây; không copy path SVG vào file feature. `IconPlay`/`IconStop` thay cho ký tự ▶/■ trong console.

## 5c. Class neutral mới trong base.css (feature không tự style lại)

- `.toast-stack` / `.toast` / `.toast--success|.toast--error|.toast--warn|.toast--info` — stack góc phải dưới + toast viền trái theo loại (thay `.vfs-toasts/.sbx-toasts…`).
- `.kv` / `.kv-pair` / `.kv--cols` — key-value list trên `<dl>`: dt muted, dd break-word; `.kv--cols` chia 2 cột (thay `.vfs-kv/.sbx-kv`).
- `.mono-pre` — `<pre>` mono cuộn, nền header-bg, max-height 420px (thay `.ov-pre/.sbx-pre`).
- `.meter` — thanh tiến trình 6px, pill, fill accent: `<div class="meter"><div style="width:42%"/></div>` (thay `.vfs-bar/.sbx-meter/.ov-progress-bar`).
- `.badge-dot` — chấm tròn trong badge trạng thái.

## 5d. Helper lib mới

- `lib/api.ts` → `putJson<T>(url, body, options?): Promise<T>` — PUT JSON, normalize lỗi giống hệt `post` (throw `ApiError`).
- `lib/nav.ts` → `useNavEffect(request, handler)` — thay pattern lastNavNonceRef/handledNonceRef lặp 3 trang: chỉ gọi handler khi `request.nonce` MỚI hơn lần trước, `request undefined` thì bỏ qua. Generic theo `{ nonce: number }` — 3 type request (VfsOpsRequest/SandboxOpsRequest/VfsManageRequest) dùng chung được.
- `lib/format.ts` → `providerTone(provider): Tone` — tone badge cho provider_state ("running"→green, "paused"→yellow) hoặc tên provider ("docker"→green, "fake"→yellow, "unknown"/rỗng→default, còn lại→red).

## 6. Shell (App.tsx) — feature không cần làm, chỉ để hiểu ngữ cảnh

- Sidebar 240px (`--sidebar-width`), chia **3 nhóm có nhãn nhỏ** (11px/600 uppercase, letterSpacing 0.08em, màu faint): Tổng quan / Kho file (VFS) / Sandbox.
- Mục nav cao 40px, chữ 14px/500, icon 20px `currentColor`; active = nền accent-soft + chữ accent + thanh trái 3px; tooltip `title` mô tả ngắn. Mỗi nhóm VFS/Sandbox có 2 mục: **Thao tác** (việc hằng ngày) và **Quản lý** (quản trị).
- Header: tiêu đề mục 20px/650 + dòng phụ 13px muted (ví dụ "VFS · Thao tác"); pill trạng thái có **chữ** ("Hoạt động"/"Mất kết nối") + badge `dev`; footer sidebar hiển thị version gateway từ `/health`.

## 7. Checklist cho agent feature (bắt buộc trước khi xong)

1. Không hardcode màu — dùng biến trong tokens.css.
2. Cỡ chữ theo bảng mục 1; không dùng font-size < 13px.
3. Nút/input theo mục 2; nút icon có `.btn-icon` + `title`.
4. Badge trạng thái tone đúng (`green`/`yellow`/`red`), weight không bị hạ; badge phiên dùng `StateBadge`.
5. Bảng dùng `.table`; cần sọc thì thêm `.table-zebra`; không tự style lại header.
6. Khoảng cách section 24px, card padding giữ nguyên từ `.card`.
7. Trạng thái active/hover phải thấy rõ cả **nền + viền + chữ** khi tự làm (không chỉ đổi màu chữ).
8. Icon import từ `components/icons.tsx` — không define SVG inline trong feature.
9. Toast dùng `components/Toast.tsx`, xác nhận dùng `components/ConfirmDialog.tsx` — không `window.confirm`, không tự làm toast.
10. NavRequest xử lý qua `useNavEffect` — không tự viết ref nonce.
