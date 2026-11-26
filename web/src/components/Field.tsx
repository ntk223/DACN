import type { ReactNode } from "react";

interface FieldProps {
  /** Nhãn phía trên control (bắt buộc — mọi input trong app nên có label). */
  label: ReactNode;
  /** Hint nhỏ dưới control. */
  hint?: ReactNode;
  children: ReactNode;
}

/** Bọc label + control (input/select/textarea tuỳ feature tự render vào children). */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: "var(--color-text)", fontWeight: 500, fontSize: "var(--font-size-sm)" }}>{label}</span>
      {children}
      {hint !== undefined ? <FieldHint>{hint}</FieldHint> : null}
    </label>
  );
}

function FieldHint({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
      {children}
    </span>
  );
}
