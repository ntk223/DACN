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

## 5. Component chung (đã nâng cấp, giữ nguyên API props)

- `Button` — variant/size/loading như cũ, to và rõ hơn qua CSS.
- `Card` — title 17px/650.
- `Badge` — weight 600, padding 3px 10px.
- `Field` — label weight 500 màu text chính; hint 13px muted.
- `Modal` — overlay `--overlay-bg` (tối hơn), nút đóng `.modal-close` 36px, title 17px/650.
- `Tabs` — tab cao 40px, underline accent 2px.
- `Toolbar`, `EmptyState`, `Spinner`, `DiffView` — giữ nguyên cách dùng.

## 6. Shell (App.tsx) — feature không cần làm, chỉ để hiểu ngữ cảnh

- Sidebar 240px (`--sidebar-width`), chia **3 nhóm có nhãn nhỏ** (11px/600 uppercase, letterSpacing 0.08em, màu faint): Tổng quan / Kho file (VFS) / Sandbox.
- Mục nav cao 40px, chữ 14px/500, icon 20px `currentColor`; active = nền accent-soft + chữ accent + thanh trái 3px; tooltip `title` mô tả ngắn. Mỗi nhóm VFS/Sandbox có 2 mục: **Thao tác** (việc hằng ngày) và **Quản lý** (quản trị).
- Header: tiêu đề mục 20px/650 + dòng phụ 13px muted (ví dụ "VFS · Thao tác"); pill trạng thái có **chữ** ("Hoạt động"/"Mất kết nối") + badge `dev`; footer sidebar hiển thị version gateway từ `/health`.

## 7. Checklist cho agent feature (bắt buộc trước khi xong)

1. Không hardcode màu — dùng biến trong tokens.css.
2. Cỡ chữ theo bảng mục 1; không dùng font-size < 13px.
3. Nút/input theo mục 2; nút icon có `.btn-icon` + `title`.
4. Badge trạng thái tone đúng (`green`/`yellow`/`red`), weight không bị hạ.
5. Bảng dùng `.table`; cần sọc thì thêm `.table-zebra`; không tự style lại header.
6. Khoảng cách section 24px, card padding giữ nguyên từ `.card`.
7. Trạng thái active/hover phải thấy rõ cả **nền + viền + chữ** khi tự làm (không chỉ đổi màu chữ).
