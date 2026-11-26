import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

interface TabItem<T extends string> {
  key: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  active: T;
  onChange: (key: T) => void;
}

/**
 * Tab ngang đơn giản (đường gạch dưới accent) — không dùng thư viện ngoài.
 * A11y: role tablist/tab, điều hướng bằng mũi tên Left/Right/Home/End,
 * roving tabIndex (tab active mới trong thứ tự Tab). Mỗi tab có
 * id = `tab-{key}` + aria-controls = `panel-{key}` — caller đặt id tương ứng
 * `panel-{key}` cho vùng nội dung (kèm role="tabpanel" + aria-labelledby).
 */
export function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  /** Chọn tab tại index và dời focus xuống nút đó. */
  const focusAndSelect = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    onChange(item.key);
    buttonsRef.current[index]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.key === active),
    );
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next !== null) {
      event.preventDefault();
      focusAndSelect(next);
    }
  };

  return (
    <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border)" }}>
      {items.map((item, index) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${item.key}`}
            aria-selected={isActive}
            aria-controls={`panel-${item.key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={onKeyDown}
            style={{
              appearance: "none",
              background: "none",
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              minHeight: "var(--tab-height)",
              padding: "0 var(--space-4)",
              cursor: "pointer",
              fontSize: "var(--font-size-base)",
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
              borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-1px",
              transition: "color 0.12s ease",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
