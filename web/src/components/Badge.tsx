import type { ReactNode } from "react";

type Tone = "default" | "green" | "yellow" | "red" | "gray";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  /** Thuộc tính title để hover giải thích ý nghĩa badge. */
  title?: string;
}

/** Nhãn trạng thái nhỏ (class .badge + biến thể màu). */
export function Badge({ tone = "default", children, title }: BadgeProps) {
  const classes = ["badge"];
  if (tone === "green") classes.push("badge-green");
  else if (tone === "yellow") classes.push("badge-yellow");
  else if (tone === "red") classes.push("badge-red");
  else if (tone === "gray") classes.push("badge-gray");
  return (
    <span className={classes.join(" ")} title={title}>
      {children}
    </span>
  );
}
