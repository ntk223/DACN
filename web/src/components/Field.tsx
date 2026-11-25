import type { ReactNode } from "react";

interface FieldProps {
  /** Nhãn phía trên control (bắt buộc — mọi input trong app nên có label). */
  label: ReactNode;
  /** Hint nhỏ dưới control. */
  hint?: ReactNode;
  /** Layout ngang: label bên trái, control bên phải (dùng trong toolbar). */
  horizontal?: boolean;
  children: ReactNode;
}

/** Bọc label + control (input/select/textarea tuỳ feature tự render vào children). */
export function Field({ label, hint, horizontal = false, children }: FieldProps) {
  if (horizontal) {
    return (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>{children}</span>
        {hint !== undefined ? <FieldHint>{hint}</FieldHint> : null}
      </label>
    );
  }
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>{label}</span>
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
