import type { ReactNode } from "react";

interface TabItem<T extends string> {
  key: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  active: T;
  onChange: (key: T) => void;
}

/** Tab ngang đơn giản (đường gạch dưới accent) — không dùng thư viện ngoài. */
export function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border)" }}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.key)}
            style={{
              appearance: "none",
              background: "none",
              border: "none",
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
              borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
