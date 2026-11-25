interface SpinnerProps {
  /** Kích thước lớn cho trang đang tải toàn màn. */
  large?: boolean;
  label?: string;
}

/** Vòng xoay loading (class .spinner). */
export function Spinner({ large = false, label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? "Đang tải"}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <span className={large ? "spinner spinner-lg" : "spinner"} />
      {label !== undefined ? <span style={{ color: "var(--color-text-muted)" }}>{label}</span> : null}
    </span>
  );
}
